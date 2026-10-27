/**
 * Newsletter configuration and the delivery guard.
 *
 * Marketing mail (newsletters) and transactional mail (password resets, publishing notices, sign-up
 * confirmations) are separate paths. Transactional mail is src/lib/email.ts with RESEND_API_KEY and is not
 * touched here. Marketing mail only ever uses RESEND_MARKETING_API_KEY, never falls back to RESEND_API_KEY,
 * and is refused outright unless every check below passes. Unset means OFF, never "whatever .env.local says":
 * NEWSLETTER_DELIVERY must be set explicitly to `resend`.
 */

type Env = Record<string, string | undefined>

// ── Policy constants (one place, unit-tested) ───────────────────────────────

export const CONSENT_VERSION = 'newsletter-consent-2026-10-23'
export const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000
export const MANAGE_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** Confirmation mails per address per 24 h (1 for an address that unsubscribed before). */
export const CONFIRMATIONS_PER_ADDRESS_PER_DAY = 3
export const RECONSENT_CONFIRMATIONS_PER_DAY = 1
export const MANAGE_LINKS_PER_ADDRESS_PER_DAY = 3
/** Site-wide ceiling on confirmation/manage mails per hour: bounds the damage of a sign-up flood. */
export const LINK_MAILS_PER_HOUR = 60
/** Unconfirmed sign-ups are deleted after this long (retention). */
export const PENDING_RETENTION_DAYS = 30
export const WEBHOOK_EVENT_RETENTION_DAYS = 30

/** Weekly edition: Friday, 18:00 UK time, with articles published at least SAFE_DELAY before it. */
export const WEEKLY_SEND_WEEKDAY = 5 // Friday (0 = Sunday)
export const WEEKLY_SEND_HOUR = 18
export const WEEKLY_SEND_MINUTE = 0
export const PUBLICATION_SAFE_DELAY_MS = 60 * 60 * 1000
/** An edition more than this late is skipped (its articles roll into the next one) rather than sent. */
export const WEEKLY_MAX_LATENESS_MS = 24 * 60 * 60 * 1000
/** Longest look-back for an edition, even after skipped weeks. */
export const WEEKLY_MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
/** Never two weekly editions within this period, whatever the edition keys say. */
export const WEEKLY_MIN_GAP_MS = 5 * 24 * 60 * 60 * 1000
export const WEEKLY_MAX_ARTICLES = 12

/** Special alerts: strict caps. */
export const ALERT_MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const ALERT_MAX_PER_30_DAYS = 3
export const ALERT_WEEKLY_BUFFER_MS = 12 * 60 * 60 * 1000
export const ALERT_MAX_ARTICLE_AGE_MS = 72 * 60 * 60 * 1000
export const ALERT_DEFAULT_DELAY_MS = 10 * 60 * 1000

/** Sending: one worker holds a campaign for this long; failed attempts back off; then a human decides. */
export const SEND_LEASE_MS = 10 * 60 * 1000
export const MAX_SEND_ATTEMPTS = 4
export const SEND_BACKOFF_MS = [10 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000]

// The site's canonical origin (production NEXT_PUBLIC_SITE_URL, every canonical tag and the sitemap; see
// docs/seo/primary-domain-switch.md). Newsletter links must use it so subscribers never land on a redirect.
export const CANONICAL_SITE_URL = 'https://theconsilium.co.uk'
const DEFAULT_FROM = 'The Consilium <newsletter@theconsilium.co.uk>'
const ALLOWED_SENDER_DOMAINS = ['theconsilium.co.uk']

// ── Site URL used in every link we email ────────────────────────────────────

/**
 * Origin for links in newsletter and confirmation emails. Never VERCEL_URL: a preview deployment's
 * address must not end up in a subscriber's inbox.
 */
export function newsletterSiteUrl(env: Env = process.env): string {
  const configured = (env.NEWSLETTER_SITE_URL || env.NEXT_PUBLIC_SITE_URL || CANONICAL_SITE_URL).trim()
  return configured.replace(/\/+$/, '')
}

// ── Delivery guard ──────────────────────────────────────────────────────────

export type DeliveryMode = 'resend' | 'capture' | 'disabled'

export interface ResendMarketingConfig {
  mode: 'resend'
  apiKey: string
  segmentId: string
  weeklyTopicId: string
  alertsTopicId: string
  from: string
  replyTo?: string
  siteUrl: string
}

export type DeliveryResolution =
  | { mode: 'resend'; config: ResendMarketingConfig }
  | { mode: 'capture'; file: string; siteUrl: string }
  | { mode: 'disabled'; reason: string }

/** True when anything says this process is a test or testing-mode environment. */
export function isTestEnvironment(env: Env = process.env): boolean {
  return (
    env.NODE_ENV === 'test' ||
    env.VITEST === 'true' ||
    env.E2E_ISOLATED === '1' ||
    env.TEST_HARNESS === '1' ||
    env.TESTING_MODE_ENABLED === '1' ||
    env.EMAIL_TRANSPORT === 'capture' ||
    env.EMAIL_TRANSPORT === 'capture-db'
  )
}

function senderDomain(from: string): string | null {
  const match = /<([^<>@\s]+)@([^<>@\s]+)>\s*$/.exec(from) ?? /^([^<>@\s]+)@([^<>@\s]+)$/.exec(from.trim())
  return match ? match[2].toLowerCase() : null
}

/**
 * Decides how newsletters may be delivered in this process. Fails closed: any doubt resolves to
 * `disabled` (nothing leaves) or, in a test environment, `capture` (written to a local file).
 */
export function resolveDelivery(env: Env = process.env): DeliveryResolution {
  const siteUrl = newsletterSiteUrl(env)
  if (isTestEnvironment(env)) {
    const file = env.NEWSLETTER_CAPTURE_FILE || env.EMAIL_CAPTURE_FILE
    return file ? { mode: 'capture', file, siteUrl } : { mode: 'disabled', reason: 'test environment without a capture file' }
  }
  const requested = (env.NEWSLETTER_DELIVERY ?? '').trim()
  if (requested === '' || requested === 'disabled') return { mode: 'disabled', reason: 'NEWSLETTER_DELIVERY is not set to resend' }
  if (requested === 'capture') {
    const file = env.NEWSLETTER_CAPTURE_FILE
    return file ? { mode: 'capture', file, siteUrl } : { mode: 'disabled', reason: 'NEWSLETTER_DELIVERY=capture requires NEWSLETTER_CAPTURE_FILE' }
  }
  if (requested !== 'resend') return { mode: 'disabled', reason: `unknown NEWSLETTER_DELIVERY value` }

  const problems: string[] = []
  const apiKey = (env.RESEND_MARKETING_API_KEY ?? '').trim()
  if (!apiKey) problems.push('RESEND_MARKETING_API_KEY is not set')
  else if (!apiKey.startsWith('re_')) problems.push('RESEND_MARKETING_API_KEY does not look like a Resend key')
  if (apiKey && apiKey === (env.RESEND_API_KEY ?? '').trim()) {
    problems.push('RESEND_MARKETING_API_KEY must be a separate key from the transactional RESEND_API_KEY')
  }
  const segmentId = (env.RESEND_NEWSLETTER_SEGMENT_ID ?? '').trim()
  const weeklyTopicId = (env.RESEND_TOPIC_WEEKLY_ID ?? '').trim()
  const alertsTopicId = (env.RESEND_TOPIC_ALERTS_ID ?? '').trim()
  if (!segmentId) problems.push('RESEND_NEWSLETTER_SEGMENT_ID is not set')
  if (!weeklyTopicId) problems.push('RESEND_TOPIC_WEEKLY_ID is not set')
  if (!alertsTopicId) problems.push('RESEND_TOPIC_ALERTS_ID is not set')
  if (weeklyTopicId && weeklyTopicId === alertsTopicId) problems.push('weekly and alerts topics must differ')
  const from = (env.NEWSLETTER_FROM || DEFAULT_FROM).trim()
  const domain = senderDomain(from)
  if (!domain || !ALLOWED_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    problems.push('NEWSLETTER_FROM must be an address on theconsilium.co.uk')
  }
  let siteOk = false
  try {
    siteOk = new URL(siteUrl).protocol === 'https:'
  } catch {
    siteOk = false
  }
  if (!siteOk) problems.push('the newsletter site URL must be https')
  // Staging isolation: only the production deployment may send, unless an operator deliberately points a
  // separate (non-production) Resend account at a staging deployment.
  const production = env.VERCEL_ENV === 'production'
  if (!production && env.NEWSLETTER_ALLOW_NON_PRODUCTION_SEND !== '1') {
    problems.push('newsletters are only sent from the production deployment')
  }
  if (production && siteUrl !== CANONICAL_SITE_URL) {
    problems.push(`production newsletters must link to ${CANONICAL_SITE_URL}`)
  }
  if (problems.length) return { mode: 'disabled', reason: problems.join('; ') }
  return {
    mode: 'resend',
    config: {
      mode: 'resend',
      apiKey,
      segmentId,
      weeklyTopicId,
      alertsTopicId,
      from,
      replyTo: env.NEWSLETTER_REPLY_TO?.trim() || undefined,
      siteUrl,
    },
  }
}
