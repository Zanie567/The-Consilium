/**
 * Subscriber lifecycle: request -> confirm (double opt-in) -> preferences -> unsubscribe.
 *
 * Rules enforced here (and tested in tests/integration/newsletter-*.test.ts):
 *   - nothing is mailed to a subscriber until they confirm; a request only creates a PENDING row and a
 *     single-use, hashed, 48-hour confirmation token;
 *   - the outcome of a request is never revealed to the requester (the route answers identically);
 *   - a request cannot change an ACTIVE subscriber's preferences or re-activate an unsubscribed one: only
 *     clicking the confirmation (a POST) does, and unsubscribing expires every outstanding confirmation link;
 *   - complaint, hard-bounce and provider suppressions are never mailed again, even if confirmed;
 *   - every change writes a consent event in the same transaction.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Prisma, Subscriber } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  CONFIRM_TOKEN_TTL_MS,
  CONFIRMATIONS_PER_ADDRESS_PER_DAY,
  CONSENT_VERSION,
  LINK_MAILS_PER_HOUR,
  MANAGE_LINKS_PER_ADDRESS_PER_DAY,
  MANAGE_TOKEN_TTL_MS,
  RECONSENT_CONFIRMATIONS_PER_DAY,
  newsletterSiteUrl,
} from './config'
import { HARD_SUPPRESSIONS, findSuppression, recordConsentEvent, upsertSuppression, type ConsentSource } from './consent'
import { confirmSubscriptionEmail, manageLinkEmail } from './emails'
import { consentUserAgent, emailHash, ipHash, normaliseEmail } from './identity'
import { generateToken, hashToken, isWellFormedToken } from './tokens'

type Tx = Prisma.TransactionClient
const DAY_MS = 24 * 60 * 60 * 1000

export interface RequestContext {
  ip?: string | null
  userAgent?: string | null
  now?: Date
}

export interface LinkMail {
  to: string
  subject: string
  html: string
}

export type SubscribeOutcome = 'confirmation_sent' | 'manage_link_sent' | 'suppressed' | 'throttled' | 'ignored'

async function lockIdentity(tx: Tx, identity: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscriber:${identity}`}))`
}

async function findByIdentity(tx: Tx, identity: string): Promise<Subscriber | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscribers WHERE public.consilium_subscriber_identity(email) = ${identity} LIMIT 1`
  return rows.length ? tx.subscriber.findUnique({ where: { id: rows[0].id } }) : null
}

/** The stored address's identity (historical rows may carry whitespace or capitals). */
export function subscriberIdentity(sub: Pick<Subscriber, 'email'>): string {
  return normaliseEmail(sub.email) ?? sub.email.trim().toLowerCase()
}

async function linkMailsInLastHour(tx: Tx, now: Date) {
  return tx.subscriberToken.count({ where: { createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } })
}

function confirmUrl(raw: string) {
  return `${newsletterSiteUrl()}/newsletter/confirm?token=${encodeURIComponent(raw)}`
}

export function manageUrl(raw: string) {
  return `${newsletterSiteUrl()}/newsletter/preferences?token=${encodeURIComponent(raw)}`
}

async function issueManageToken(tx: Tx, subscriberId: string, now: Date): Promise<string> {
  const token = generateToken()
  await tx.subscriberToken.create({
    data: { subscriberId, purpose: 'MANAGE', tokenHash: token.hash, expiresAt: new Date(now.getTime() + MANAGE_TOKEN_TTL_MS), createdAt: now },
  })
  return token.raw
}

// ── Request ─────────────────────────────────────────────────────────────────

export async function requestSubscription(
  input: { email: string; alerts: boolean; source?: ConsentSource },
  ctx: RequestContext = {},
): Promise<{ outcome: SubscribeOutcome; mail?: LinkMail }> {
  const identity = normaliseEmail(input.email)
  if (!identity) throw new Error('requestSubscription called with an invalid address')
  const now = ctx.now ?? new Date()
  const source = input.source ?? 'signup_form'
  const evidence = { ipHash: ipHash(ctx.ip), userAgent: consentUserAgent(ctx.userAgent) }

  return prisma.$transaction(async (tx) => {
    await lockIdentity(tx, identity)
    if ((await linkMailsInLastHour(tx, now)) >= LINK_MAILS_PER_HOUR) {
      return { outcome: 'throttled' as const }
    }
    const existing = await findByIdentity(tx, identity)
    const suppression = await findSuppression(tx, identity)

    if (existing?.status === 'SUPPRESSED' || (suppression && HARD_SUPPRESSIONS.includes(suppression))) {
      await recordConsentEvent(tx, { subscriberId: existing?.id ?? null, identity, action: 'SIGNUP_IGNORED', source, ...evidence, detail: { reason: 'suppressed' } })
      return { outcome: 'suppressed' as const }
    }

    if (existing?.status === 'ACTIVE') {
      // Already subscribed: never touch their choices. Send (rate-limited) a preferences link instead.
      const recent = await tx.subscriberToken.count({ where: { subscriberId: existing.id, purpose: 'MANAGE', createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })
      if (recent >= MANAGE_LINKS_PER_ADDRESS_PER_DAY) return { outcome: 'throttled' as const }
      const raw = await issueManageToken(tx, existing.id, now)
      await recordConsentEvent(tx, { subscriberId: existing.id, identity, action: 'MANAGE_LINK_REQUESTED', source, ...evidence })
      return { outcome: 'manage_link_sent' as const, mail: { to: identity, ...manageLinkEmail(manageUrl(raw)) } }
    }

    // New, pending, legacy or previously unsubscribed: a fresh confirmation is the only way in.
    const reconsent = existing?.status === 'UNSUBSCRIBED' || suppression === 'UNSUBSCRIBED'
    const subscriber =
      existing ??
      (await tx.subscriber.create({
        data: { email: identity, status: 'PENDING', weeklyDigest: true, specialAlerts: false, resendSyncState: 'SYNCED' },
      }))
    const limit = reconsent ? RECONSENT_CONFIRMATIONS_PER_DAY : CONFIRMATIONS_PER_ADDRESS_PER_DAY
    const recent = await tx.subscriberToken.count({ where: { subscriberId: subscriber.id, purpose: 'CONFIRM', createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })
    if (recent >= limit) {
      await recordConsentEvent(tx, { subscriberId: subscriber.id, identity, action: 'SIGNUP_IGNORED', source, ...evidence, detail: { reason: 'rate_limited' } })
      return { outcome: 'throttled' as const }
    }
    // Only the newest confirmation link works.
    await tx.subscriberToken.updateMany({
      where: { subscriberId: subscriber.id, purpose: 'CONFIRM', usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    })
    const token = generateToken()
    const created = await tx.subscriberToken.create({
      data: { subscriberId: subscriber.id, purpose: 'CONFIRM', tokenHash: token.hash, expiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS), createdAt: now },
    })
    // The requested choices live on the request record and only take effect when this token is confirmed.
    await recordConsentEvent(tx, {
      subscriberId: subscriber.id,
      identity,
      action: 'SIGNUP_REQUESTED',
      source,
      weeklyDigest: true,
      specialAlerts: input.alerts,
      consentVersion: CONSENT_VERSION,
      ...evidence,
      detail: { tokenId: created.id, previousStatus: existing?.status ?? null },
    })
    return { outcome: 'confirmation_sent' as const, mail: { to: identity, ...confirmSubscriptionEmail(confirmUrl(token.raw), input.alerts) } }
  })
}

// ── Confirm ─────────────────────────────────────────────────────────────────

export type ConfirmOutcome = 'confirmed' | 'already_confirmed' | 'expired' | 'invalid' | 'suppressed'

export async function confirmSubscription(
  rawToken: unknown,
  ctx: RequestContext = {},
): Promise<{ outcome: ConfirmOutcome; subscriberId?: string; manageToken?: string }> {
  if (!isWellFormedToken(rawToken)) return { outcome: 'invalid' }
  const now = ctx.now ?? new Date()
  const tokenHash = hashToken(rawToken)

  return prisma.$transaction(async (tx) => {
    const token = await tx.subscriberToken.findUnique({ where: { tokenHash }, include: { subscriber: true } })
    if (!token || token.purpose !== 'CONFIRM') return { outcome: 'invalid' as const }
    if (token.usedAt) return { outcome: token.subscriber.status === 'ACTIVE' ? ('already_confirmed' as const) : ('invalid' as const) }
    if (token.expiresAt <= now) return { outcome: 'expired' as const }
    // Single use, even under a race: only one request flips usedAt.
    const claimed = await tx.subscriberToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
    if (claimed.count !== 1) return { outcome: 'already_confirmed' as const }

    const identity = subscriberIdentity(token.subscriber)
    await lockIdentity(tx, identity)
    const sub = await tx.subscriber.findUniqueOrThrow({ where: { id: token.subscriberId } })
    const suppression = await findSuppression(tx, identity)
    if (sub.status === 'SUPPRESSED' || (suppression && HARD_SUPPRESSIONS.includes(suppression))) {
      await recordConsentEvent(tx, { subscriberId: sub.id, identity, action: 'RESUBSCRIBE_REFUSED', source: 'confirm_page', detail: { reason: suppression ?? 'suppressed' } })
      return { outcome: 'suppressed' as const }
    }
    const request = await tx.subscriberConsentEvent.findFirst({
      where: { subscriberId: sub.id, action: 'SIGNUP_REQUESTED', detail: { path: ['tokenId'], equals: token.id } },
      orderBy: { createdAt: 'desc' },
    })
    const specialAlerts = request?.specialAlerts === true
    const evidence = { ipHash: ipHash(ctx.ip), userAgent: consentUserAgent(ctx.userAgent) }
    await tx.subscriber.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        weeklyDigest: true,
        specialAlerts,
        confirmedAt: now,
        consentSource: request?.source ?? 'signup_form',
        consentVersion: request?.consentVersion ?? CONSENT_VERSION,
        consentIpHash: evidence.ipHash,
        preferencesUpdatedAt: now,
        unsubscribedAt: null,
        unsubscribeSource: null,
        resendSyncState: 'PENDING',
        resendSyncAttempts: 0,
        resendSyncError: null,
      },
    })
    if (suppression === 'UNSUBSCRIBED') {
      // A confirmed, explicit new consent supersedes the earlier withdrawal.
      await tx.newsletterSuppression.deleteMany({ where: { emailHash: emailHash(identity), reason: 'UNSUBSCRIBED' } })
    }
    await recordConsentEvent(tx, {
      subscriberId: sub.id,
      identity,
      action: 'CONFIRMED',
      source: 'confirm_page',
      weeklyDigest: true,
      specialAlerts,
      consentVersion: request?.consentVersion ?? CONSENT_VERSION,
      ...evidence,
      detail: { tokenId: token.id, previousStatus: sub.status },
    })
    const manageToken = await issueManageToken(tx, sub.id, now)
    return { outcome: 'confirmed' as const, subscriberId: sub.id, manageToken }
  })
}

// ── Preference centre ───────────────────────────────────────────────────────

export function maskEmail(identity: string): string {
  const [local, domain] = identity.split('@')
  if (!domain) return '***'
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`
}

export interface PreferenceView {
  maskedEmail: string
  status: Subscriber['status']
  weeklyDigest: boolean
  specialAlerts: boolean
}

async function resolveManageToken(db: Tx | typeof prisma, rawToken: unknown, now: Date) {
  if (!isWellFormedToken(rawToken)) return null
  const token = await db.subscriberToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { subscriber: true } })
  if (!token || token.purpose !== 'MANAGE' || token.usedAt || token.expiresAt <= now) return null
  return token
}

export async function loadPreferences(rawToken: unknown, now = new Date()): Promise<PreferenceView | null> {
  const token = await resolveManageToken(prisma, rawToken, now)
  if (!token) return null
  const sub = token.subscriber
  return { maskedEmail: maskEmail(subscriberIdentity(sub)), status: sub.status, weeklyDigest: sub.weeklyDigest, specialAlerts: sub.specialAlerts }
}

export type PreferenceOutcome = 'updated' | 'unchanged' | 'unsubscribed' | 'already_unsubscribed' | 'not_active' | 'invalid'

export async function updatePreferences(
  rawToken: unknown,
  prefs: { weeklyDigest: boolean; specialAlerts: boolean },
  ctx: RequestContext = {},
): Promise<{ outcome: PreferenceOutcome; subscriberId?: string }> {
  const now = ctx.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const token = await resolveManageToken(tx, rawToken, now)
    if (!token) return { outcome: 'invalid' as const }
    const identity = subscriberIdentity(token.subscriber)
    await lockIdentity(tx, identity)
    const sub = await tx.subscriber.findUniqueOrThrow({ where: { id: token.subscriberId } })
    if (sub.status !== 'ACTIVE') return { outcome: 'not_active' as const }
    if (!prefs.weeklyDigest && !prefs.specialAlerts) {
      return { outcome: await unsubscribeInTx(tx, sub, 'preference_centre', ctx, now), subscriberId: sub.id }
    }
    if (sub.weeklyDigest === prefs.weeklyDigest && sub.specialAlerts === prefs.specialAlerts) return { outcome: 'unchanged' as const, subscriberId: sub.id }
    await tx.subscriber.update({
      where: { id: sub.id },
      data: { weeklyDigest: prefs.weeklyDigest, specialAlerts: prefs.specialAlerts, preferencesUpdatedAt: now, resendSyncState: 'PENDING', resendSyncAttempts: 0, resendSyncError: null },
    })
    await recordConsentEvent(tx, {
      subscriberId: sub.id,
      identity,
      action: 'PREFERENCES_UPDATED',
      source: 'preference_centre',
      weeklyDigest: prefs.weeklyDigest,
      specialAlerts: prefs.specialAlerts,
      consentVersion: CONSENT_VERSION,
      ipHash: ipHash(ctx.ip),
      userAgent: consentUserAgent(ctx.userAgent),
      detail: { previous: { weeklyDigest: sub.weeklyDigest, specialAlerts: sub.specialAlerts } },
    })
    return { outcome: 'updated' as const, subscriberId: sub.id }
  })
}

/** Withdraws consent. Idempotent. Expires every outstanding confirmation link (no accidental re-subscribe). */
export async function unsubscribeInTx(
  tx: Tx,
  sub: Subscriber,
  source: ConsentSource,
  ctx: RequestContext,
  now: Date,
  actor: string = 'subscriber',
): Promise<'unsubscribed' | 'already_unsubscribed'> {
  const identity = subscriberIdentity(sub)
  await tx.subscriberToken.updateMany({ where: { subscriberId: sub.id, purpose: 'CONFIRM', usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } })
  if (sub.status === 'UNSUBSCRIBED' || sub.status === 'SUPPRESSED') return 'already_unsubscribed'
  await tx.subscriber.update({
    where: { id: sub.id },
    data: {
      status: 'UNSUBSCRIBED',
      unsubscribedAt: now,
      unsubscribeSource: source,
      preferencesUpdatedAt: now,
      // A row that was never confirmed was never in Resend; anything else must be withdrawn there too.
      resendSyncState: sub.confirmedAt || sub.resendContactId ? 'PENDING' : 'SYNCED',
      resendSyncAttempts: 0,
      resendSyncError: null,
    },
  })
  await upsertSuppression(tx, identity, 'UNSUBSCRIBED', source)
  await recordConsentEvent(tx, {
    subscriberId: sub.id,
    identity,
    action: 'UNSUBSCRIBED',
    source,
    weeklyDigest: false,
    specialAlerts: false,
    ipHash: ipHash(ctx.ip),
    userAgent: consentUserAgent(ctx.userAgent),
    actor,
    detail: { previousStatus: sub.status },
  })
  return 'unsubscribed'
}

export async function unsubscribeByToken(rawToken: unknown, ctx: RequestContext = {}): Promise<{ outcome: PreferenceOutcome; subscriberId?: string }> {
  const now = ctx.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const token = await resolveManageToken(tx, rawToken, now)
    if (!token) return { outcome: 'invalid' as const }
    await lockIdentity(tx, subscriberIdentity(token.subscriber))
    const sub = await tx.subscriber.findUniqueOrThrow({ where: { id: token.subscriberId } })
    return { outcome: await unsubscribeInTx(tx, sub, 'preference_centre', ctx, now), subscriberId: sub.id }
  })
}

// ── Links in emails sent before this system (HMAC of the address) ───────────

export function verifyLegacyUnsubscribeToken(email: string, token: string, secret = process.env.NEXTAUTH_SECRET): boolean {
  // No fallback secret: the old code fell back to a constant, which made every link forgeable.
  if (!secret || !/^[0-9a-f]{64}$/.test(token)) return false
  const expected = createHmac('sha256', secret).update(email.toLowerCase()).digest()
  return timingSafeEqual(expected, Buffer.from(token, 'hex'))
}

export async function unsubscribeByLegacyLink(email: unknown, token: unknown, ctx: RequestContext = {}): Promise<{ outcome: PreferenceOutcome; subscriberId?: string }> {
  if (typeof email !== 'string' || typeof token !== 'string' || !verifyLegacyUnsubscribeToken(email, token)) return { outcome: 'invalid' }
  const identity = normaliseEmail(email)
  if (!identity) return { outcome: 'invalid' }
  const now = ctx.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await lockIdentity(tx, identity)
    const sub = await findByIdentity(tx, identity)
    if (!sub) {
      // Nothing to withdraw, but still remember the wish so a stray form submission cannot re-add the address.
      await upsertSuppression(tx, identity, 'UNSUBSCRIBED', 'legacy_unsubscribe_link')
      return { outcome: 'already_unsubscribed' as const }
    }
    return { outcome: await unsubscribeInTx(tx, sub, 'legacy_unsubscribe_link', ctx, now), subscriberId: sub.id }
  })
}

// ── Manage-link requests ────────────────────────────────────────────────────

export async function requestManageLink(email: unknown, ctx: RequestContext = {}): Promise<{ outcome: SubscribeOutcome; mail?: LinkMail }> {
  const identity = normaliseEmail(email)
  if (!identity) return { outcome: 'ignored' }
  const now = ctx.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await lockIdentity(tx, identity)
    if ((await linkMailsInLastHour(tx, now)) >= LINK_MAILS_PER_HOUR) return { outcome: 'throttled' as const }
    const sub = await findByIdentity(tx, identity)
    const suppression = await findSuppression(tx, identity)
    if (!sub || sub.status === 'PENDING' || sub.status === 'SUPPRESSED' || (suppression && HARD_SUPPRESSIONS.includes(suppression))) {
      return { outcome: 'ignored' as const }
    }
    const recent = await tx.subscriberToken.count({ where: { subscriberId: sub.id, purpose: 'MANAGE', createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })
    if (recent >= MANAGE_LINKS_PER_ADDRESS_PER_DAY) return { outcome: 'throttled' as const }
    const raw = await issueManageToken(tx, sub.id, now)
    await recordConsentEvent(tx, { subscriberId: sub.id, identity, action: 'MANAGE_LINK_REQUESTED', source: 'manage_link_form', ipHash: ipHash(ctx.ip), userAgent: consentUserAgent(ctx.userAgent) })
    return { outcome: 'manage_link_sent' as const, mail: { to: identity, ...manageLinkEmail(manageUrl(raw)) } }
  })
}

/** From the preference centre of an unsubscribed or legacy subscriber: starts a fresh double opt-in. */
export async function requestReconfirmation(rawToken: unknown, ctx: RequestContext = {}): Promise<{ outcome: SubscribeOutcome | 'invalid'; mail?: LinkMail }> {
  const token = await resolveManageToken(prisma, rawToken, ctx.now ?? new Date())
  if (!token) return { outcome: 'invalid' }
  if (token.subscriber.status === 'ACTIVE') return { outcome: 'ignored' }
  return requestSubscription({ email: subscriberIdentity(token.subscriber), alerts: false, source: 'preference_centre' }, ctx)
}
