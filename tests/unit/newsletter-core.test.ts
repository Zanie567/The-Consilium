/**
 * Newsletter building blocks that need no database: address identity, hashing, tokens, the delivery guard
 * (staging isolation, separate marketing credentials), the DST-safe weekly schedule, link building and the
 * content hash that approvals are bound to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { consentUserAgent, emailHash, ipHash, normaliseEmail } from '@/lib/newsletter/identity'
import { generateToken, hashToken, isWellFormedToken } from '@/lib/newsletter/tokens'
import { CANONICAL_SITE_URL, isTestEnvironment, newsletterSiteUrl, resolveDelivery } from '@/lib/newsletter/config'
import { currentWeeklySlot, londonWallTimeToUtc, slotForEditionKey } from '@/lib/newsletter/schedule'
import { absoluteImageUrl, canonicalArticleUrl, contentHash, type EditionItem } from '@/lib/newsletter/edition'
import { maskEmail } from '@/lib/newsletter/subscriptions'
import { verifyNewsletterCronAuth } from '@/lib/cronAuth'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('address identity', () => {
  it.each([
    ['  Reader@Example.COM ', 'reader@example.com'],
    ['\treader@example.com\n', 'reader@example.com'],
    [' reader@example.com﻿', 'reader@example.com'],
  ])('normalises %j like consilium_subscriber_identity', (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected)
  })

  it.each(['', '   ', 'not-an-email', 'a@b', `${'x'.repeat(250)}@a.co`, 42, null, ['a@b.co']])('rejects %j', (input) => {
    expect(normaliseEmail(input)).toBeNull()
  })

  it('hashes with the same recipe as the migration SQL', () => {
    const expected = createHash('sha256').update('consilium-newsletter:v1:reader@example.com').digest('hex')
    expect(emailHash('reader@example.com')).toBe(expected)
    const sql = readFileSync('supabase/migrations/20261023120000_newsletter_subscriptions.sql', 'utf8')
    expect(sql).toContain("sha256(convert_to('consilium-newsletter:v1:' || public.consilium_subscriber_identity(s.\"email\"), 'UTF8'))")
  })

  it('stores a keyed IP hash only when a key exists, never the IP itself', () => {
    vi.stubEnv('NEWSLETTER_IP_HASH_SECRET', '')
    vi.stubEnv('NEXTAUTH_SECRET', '')
    expect(ipHash('203.0.113.5')).toBeNull()
    vi.stubEnv('NEWSLETTER_IP_HASH_SECRET', 'k'.repeat(32))
    const hashed = ipHash('203.0.113.5')
    expect(hashed).toMatch(/^[0-9a-f]{32}$/)
    expect(hashed).not.toContain('203')
    expect(ipHash('unknown')).toBeNull()
  })

  it('truncates and cleans user agents', () => {
    expect(consentUserAgent(`Mozilla\u0000/5.0 ${'x'.repeat(400)}`)).toHaveLength(200)
    expect(consentUserAgent('   ')).toBeNull()
  })

  it('masks addresses on the preference page', () => {
    expect(maskEmail('reader@example.com')).toBe('re****@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
  })
})

describe('link tokens', () => {
  it('are 256-bit, url-safe, and only their SHA-256 is stored', () => {
    const { raw, hash } = generateToken()
    expect(isWellFormedToken(raw)).toBe(true)
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(hashToken(raw)).toBe(hash)
    expect(generateToken().raw).not.toBe(raw)
  })

  it.each(['', 'short', 'x'.repeat(44), 'a/b+c='.padEnd(43, 'a'), ['x'.repeat(43)], null])('rejects malformed %j', (value) => {
    expect(isWellFormedToken(value)).toBe(false)
  })
})

describe('delivery guard (staging isolation and separate credentials)', () => {
  const production = {
    NODE_ENV: 'production',
    VITEST: '',
    VERCEL_ENV: 'production',
    NEWSLETTER_DELIVERY: 'resend',
    RESEND_MARKETING_API_KEY: 're_marketing_key_123',
    RESEND_API_KEY: 're_transactional_key_456',
    RESEND_NEWSLETTER_SEGMENT_ID: 'seg_1',
    RESEND_TOPIC_WEEKLY_ID: 'topic_weekly',
    RESEND_TOPIC_ALERTS_ID: 'topic_alerts',
    NEXT_PUBLIC_SITE_URL: CANONICAL_SITE_URL,
  }

  it('allows Resend only on production with every setting present', () => {
    const result = resolveDelivery(production)
    expect(result.mode).toBe('resend')
    if (result.mode === 'resend') {
      expect(result.config.apiKey).toBe('re_marketing_key_123')
      expect(result.config.from).toMatch(/@theconsilium\.co\.uk>$/)
    }
  })

  it.each([
    ['unset', { NEWSLETTER_DELIVERY: '' }, /not set to resend/],
    ['a preview deployment', { VERCEL_ENV: 'preview' }, /only sent from the production deployment/],
    ['local development', { VERCEL_ENV: undefined }, /only sent from the production deployment/],
    ['the transactional key reused', { RESEND_MARKETING_API_KEY: 're_transactional_key_456' }, /separate key/],
    ['no marketing key (never falls back to RESEND_API_KEY)', { RESEND_MARKETING_API_KEY: '' }, /RESEND_MARKETING_API_KEY is not set/],
    ['a non-Resend key', { RESEND_MARKETING_API_KEY: 'sk_test_123' }, /does not look like a Resend key/],
    ['a missing topic', { RESEND_TOPIC_ALERTS_ID: '' }, /RESEND_TOPIC_ALERTS_ID/],
    ['identical topics', { RESEND_TOPIC_ALERTS_ID: 'topic_weekly' }, /topics must differ/],
    ['a foreign sender', { NEWSLETTER_FROM: 'News <news@example.com>' }, /theconsilium\.co\.uk/],
    ['links to a preview host', { NEXT_PUBLIC_SITE_URL: 'https://the-consilium-git-x.vercel.app' }, /must link to/],
    ['plain http links', { NEXT_PUBLIC_SITE_URL: 'http://www.theconsilium.co.uk' }, /https/],
  ])('refuses %s', (_label, override, reason) => {
    const result = resolveDelivery({ ...production, ...override } as Record<string, string | undefined>)
    expect(result.mode).toBe('disabled')
    if (result.mode === 'disabled') expect(result.reason).toMatch(reason)
  })

  it.each([
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['vitest', { VITEST: 'true' }],
    ['the isolated E2E stack', { E2E_ISOLATED: '1' }],
    ['testing mode', { TESTING_MODE_ENABLED: '1' }],
    ['captured transactional email', { EMAIL_TRANSPORT: 'capture' }],
  ])('never uses Resend under %s, even with production credentials', (_label, override) => {
    const env = { ...production, ...override } as Record<string, string | undefined>
    expect(isTestEnvironment(env)).toBe(true)
    expect(resolveDelivery(env).mode).toBe('disabled')
    expect(resolveDelivery({ ...env, EMAIL_CAPTURE_FILE: '/tmp/outbox.jsonl' }).mode).toBe('capture')
  })

  it('a non-production send needs a deliberate operator flag', () => {
    expect(resolveDelivery({ ...production, VERCEL_ENV: 'preview', NEXT_PUBLIC_SITE_URL: 'https://staging.example.org', NEWSLETTER_ALLOW_NON_PRODUCTION_SEND: '1' }).mode).toBe('resend')
  })

  it('links never use VERCEL_URL', () => {
    expect(newsletterSiteUrl({ VERCEL_URL: 'preview.vercel.app' })).toBe(CANONICAL_SITE_URL)
    expect(newsletterSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3200/' })).toBe('http://localhost:3200')
  })

  it('the transactional mailer never reads the marketing key, and only provider.ts imports the Resend SDK for newsletters', () => {
    expect(readFileSync('src/lib/email.ts', 'utf8')).not.toMatch(/RESEND_MARKETING_API_KEY|broadcast/i)
    const provider = readFileSync('src/lib/newsletter/provider.ts', 'utf8')
    expect(provider).not.toMatch(/RESEND_API_KEY/)
    expect(provider).not.toMatch(/emails\.send|batch\.send/)
    const config = readFileSync('src/lib/newsletter/config.ts', 'utf8')
    // RESEND_API_KEY appears only in the "must be a separate key" comparison.
    expect(config.match(/env\.RESEND_API_KEY/g)).toHaveLength(1)
  })
})

describe('weekly schedule (Europe/London, DST-safe)', () => {
  it.each([
    // [now (UTC), expected edition key, expected send time (UTC)]
    ['2026-10-23T12:00:00Z', 'weekly:2026-10-23', '2026-10-23T17:00:00.000Z'], // Friday in BST
    ['2026-10-24T09:00:00Z', 'weekly:2026-10-23', '2026-10-23T17:00:00.000Z'], // Saturday
    ['2026-10-29T22:00:00Z', 'weekly:2026-10-23', '2026-10-23T17:00:00.000Z'], // Thursday after the clocks went back
    ['2026-10-30T19:00:00Z', 'weekly:2026-10-30', '2026-10-30T18:00:00.000Z'], // first Friday in GMT
    ['2027-03-26T18:30:00Z', 'weekly:2027-03-26', '2027-03-26T18:00:00.000Z'], // last Friday in GMT
    ['2027-04-02T16:59:00Z', 'weekly:2027-04-02', '2027-04-02T17:00:00.000Z'], // first Friday in BST
    ['2026-10-23T23:30:00Z', 'weekly:2026-10-23', '2026-10-23T17:00:00.000Z'], // 00:30 Saturday in London
  ])('at %s the edition is %s, sent at %s', (now, key, sendAt) => {
    const slot = currentWeeklySlot(new Date(now))
    expect(slot.editionKey).toBe(key)
    expect(slot.sendAt.toISOString()).toBe(sendAt)
    expect(slot.sendAt.getTime() - slot.cutoff.getTime()).toBe(60 * 60 * 1000)
  })

  it('gives the same answer whatever the server time zone is', () => {
    const original = process.env.TZ
    const now = new Date('2026-10-30T17:45:00Z')
    const results = new Set<string>()
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Europe/London']) {
        process.env.TZ = tz
        const slot = currentWeeklySlot(now)
        results.add(`${slot.editionKey}|${slot.sendAt.toISOString()}|${slot.cutoff.toISOString()}`)
      }
    } finally {
      process.env.TZ = original
    }
    expect([...results]).toEqual(['weekly:2026-10-30|2026-10-30T18:00:00.000Z|2026-10-30T17:00:00.000Z'])
  })

  it('round-trips edition keys and London wall time', () => {
    expect(slotForEditionKey('weekly:2026-10-30')?.sendAt.toISOString()).toBe('2026-10-30T18:00:00.000Z')
    expect(slotForEditionKey('alert:x')).toBeNull()
    expect(londonWallTimeToUtc(2026, 7, 3, 18, 0).toISOString()).toBe('2026-07-03T17:00:00.000Z')
  })
})

describe('links and content', () => {
  it('builds canonical article links or refuses', () => {
    expect(canonicalArticleUrl('inflation-and-rates', 'https://www.theconsilium.co.uk')).toBe('https://www.theconsilium.co.uk/articles/inflation-and-rates')
    expect(canonicalArticleUrl('', 'https://www.theconsilium.co.uk')).toBeNull()
    expect(canonicalArticleUrl(null, 'https://www.theconsilium.co.uk')).toBeNull()
    expect(canonicalArticleUrl('a/b', 'https://www.theconsilium.co.uk')).toBeNull()
    expect(canonicalArticleUrl('has space', 'https://www.theconsilium.co.uk')).toBeNull()
    expect(canonicalArticleUrl('café', 'https://www.theconsilium.co.uk')).toBe('https://www.theconsilium.co.uk/articles/caf%C3%A9')
  })

  it('only uses https images (relative paths made absolute)', () => {
    const site = 'https://www.theconsilium.co.uk'
    expect(absoluteImageUrl('/team/x.png', site)).toBe('https://www.theconsilium.co.uk/team/x.png')
    expect(absoluteImageUrl('https://cdn.example.com/a.jpg', site)).toBe('https://cdn.example.com/a.jpg')
    expect(absoluteImageUrl('http://cdn.example.com/a.jpg', site)).toBeNull()
    expect(absoluteImageUrl('data:image/png;base64,AAAA', site)).toBeNull()
    expect(absoluteImageUrl('//evil.example/a.png', site)).toBeNull()
    expect(absoluteImageUrl(null, site)).toBeNull()
  })

  it('binds approval to every visible field', () => {
    const item: EditionItem = { id: 'a', slug: 's', title: 'T', author: 'A', summary: 'S', sourceExcerpt: 'S', imageUrl: null, imageAlt: '', url: 'https://x/articles/s', category: null, publishedAt: '2026-10-23T10:00:00.000Z' }
    const base = contentHash({ subject: 'Sub', previewText: 'P', intro: null, items: [item] })
    expect(contentHash({ subject: 'Sub', previewText: 'P', intro: null, items: [item] })).toBe(base)
    expect(contentHash({ subject: 'Sub!', previewText: 'P', intro: null, items: [item] })).not.toBe(base)
    expect(contentHash({ subject: 'Sub', previewText: 'P', intro: 'Hi', items: [item] })).not.toBe(base)
    expect(contentHash({ subject: 'Sub', previewText: 'P', intro: null, items: [{ ...item, summary: 'Other' }] })).not.toBe(base)
    expect(contentHash({ subject: 'Sub', previewText: 'P', intro: null, items: [] })).not.toBe(base)
  })
})

describe('newsletter cron credential', () => {
  const LONG = 'newsletter-only-secret-0123456789-abcdefghijklmnop'
  const req = (token: string) => new Request('http://localhost/api/cron/newsletter', { method: 'POST', headers: { authorization: `Bearer ${token}` } })

  it('accepts the dedicated secret or the shared CRON_SECRET, nothing else', () => {
    vi.stubEnv('CRON_SECRET', 'shared-secret')
    vi.stubEnv('NEWSLETTER_CRON_SECRET', LONG)
    expect(verifyNewsletterCronAuth(req(LONG), 't')).toBeNull()
    expect(verifyNewsletterCronAuth(req('shared-secret'), 't')).toBeNull()
    expect(verifyNewsletterCronAuth(req('wrong'), 't')?.status).toBe(401)
  })

  it('ignores a dedicated secret that is too short, and fails closed with nothing configured', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('NEWSLETTER_CRON_SECRET', 'short')
    expect(verifyNewsletterCronAuth(req('short'), 't')?.status).toBe(500)
    vi.restoreAllMocks()
  })
})

describe('activation stays with the owner', () => {
  it('the newsletter workflow is manual-only, guarded, and never prints the response body', () => {
    const text = readFileSync('.github/workflows/newsletter-tick.yml', 'utf8')
    expect(text).not.toMatch(/^\s{2}schedule:/m)
    expect(text).toMatch(/^\s{2}workflow_dispatch:/m)
    expect(text).toContain("if: github.repository == 'Zanie567/The-Consilium' && github.ref == 'refs/heads/main'")
    expect(text).not.toMatch(/cat "\$BODY_FILE"|echo "\$\(cat/)
  })

  it('the Supabase Cron activation is a manual file, not a migration, and its function is private', () => {
    expect(() => readFileSync('supabase/migrations/newsletter_cron_enable.sql', 'utf8')).toThrow()
    const sql = readFileSync('supabase/manual/newsletter_cron_enable.sql', 'utf8')
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.invoke_newsletter_tick() FROM PUBLIC")
    expect(sql).not.toMatch(/Bearer [0-9a-f]{16,}/)
  })

  it('vercel.json schedules no newsletter job', () => {
    expect(readFileSync('vercel.json', 'utf8')).not.toMatch(/newsletter/)
  })
})
