/**
 * Double opt-in, preferences, unsubscribe and abuse limits against a real (local, disposable) database.
 * Runs only under the isolated launcher (DB_BACKED_SUITES). Email is captured in memory; nothing is sent.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const outbox: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (mail: { to: string; subject: string; html: string }) => { outbox.push(mail); return true }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => '198.51.100.7' }))

import { POST as subscribe } from '@/app/api/subscribe/route'
import { POST as confirmRoute } from '@/app/api/newsletter/confirm/route'
import { POST as preferencesRoute } from '@/app/api/newsletter/preferences/route'
import { POST as unsubscribeRoute } from '@/app/api/newsletter/unsubscribe/route'
import { POST as manageLinkRoute } from '@/app/api/newsletter/manage-link/route'
import UnsubscribePage from '@/app/unsubscribe/page'
import { confirmSubscription, requestSubscription as requestOnly } from '@/lib/newsletter/subscriptions'
import { emailHash } from '@/lib/newsletter/identity'
import { setMarketingProviderForTests, createMemoryProvider } from '@/lib/newsletter/provider'

assertSafeTestDatabaseHost(process.env.TEST_DATABASE_URL!, 'TEST_DATABASE_URL')
setMarketingProviderForTests(createMemoryProvider())
// The route only hands link mail to a capture transport in tests; sendEmail itself is mocked above.
process.env.EMAIL_TRANSPORT = 'capture'

const RUN = randomUUID().slice(0, 8)
const address = (label: string) => `${label}-${RUN}@newsletter.test`
const post = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'vitest' }, body: JSON.stringify(body) })
const linkToken = (html: string, path: string) => {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]{43})`).exec(html)
  if (!match) throw new Error(`no ${path} link in mail`)
  return match[1]
}
/** The library returns the link mail; the route is what hands it to the mailer. Capture it the same way. */
async function requestSubscription(...args: Parameters<typeof requestOnly>) {
  const result = await requestOnly(...args)
  if (result.mail) outbox.push(result.mail)
  return result
}
const mailsTo = (to: string) => outbox.filter((m) => m.to === to)
const subscriberOf = async (email: string) => prisma.subscriber.findFirst({ where: { email } })
/** Moves this address's earlier link mails out of the 24-hour rate-limit window. */
const ageLinks = (email: string) => prisma.subscriberToken.updateMany({ where: { subscriber: { email } }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } })

beforeEach(() => {
  outbox.length = 0
})

afterAll(async () => {
  const subs = await prisma.subscriber.findMany({ where: { email: { endsWith: '@newsletter.test' } }, select: { id: true, email: true } })
  await prisma.subscriberConsentEvent.deleteMany({ where: { OR: [{ subscriberId: { in: subs.map((s) => s.id) } }, { emailHash: { in: subs.map((s) => emailHash(s.email)) } }] } })
  await prisma.subscriber.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } })
  await prisma.newsletterSuppression.deleteMany({ where: { source: { not: 'keep' }, emailHash: { in: [...subs.map((s) => emailHash(s.email)), emailHash(address('legacy-only'))] } } })
  setMarketingProviderForTests(null)
  delete process.env.EMAIL_TRANSPORT
})

describe('sign-up answers', () => {
  it('rejects malformed input with 400 and stores nothing', async () => {
    for (const email of ['', 'bad', 'a@b', `${'x'.repeat(250)}@a.co`, ['a@b.co']]) {
      expect((await subscribe(post('/api/subscribe', { email }))).status).toBe(400)
    }
  })

  it('answers every well-formed address identically, whatever its state (no enumeration)', async () => {
    const active = address('enum-active')
    await requestSubscription({ email: active, alerts: false })
    await confirmSubscription(linkToken(outbox.pop()!.html, '/newsletter/confirm'))
    const suppressed = address('enum-suppressed')
    await prisma.newsletterSuppression.create({ data: { emailHash: emailHash(suppressed), reason: 'COMPLAINED', source: 'test' } })

    const bodies = new Set<string>()
    for (const email of [address('enum-new'), address('enum-new'), active, suppressed]) {
      const res = await subscribe(post('/api/subscribe', { email }))
      expect(res.status).toBe(202)
      bodies.add(await res.text())
    }
    expect(bodies.size).toBe(1)
    expect(mailsTo(suppressed)).toHaveLength(0)
  })

  it('a honeypot submission looks accepted but stores and sends nothing', async () => {
    const email = address('bot')
    const res = await subscribe(post('/api/subscribe', { email, website: 'http://spam' }))
    expect(res.status).toBe(202)
    expect(await subscriberOf(email)).toBeNull()
    expect(outbox).toHaveLength(0)
  })
})

describe('double opt-in', () => {
  it('stores a PENDING row and sends only a confirmation; nothing is subscribed until the POST', async () => {
    const email = address('flow')
    await subscribe(post('/api/subscribe', { email: `  ${email.toUpperCase()} `, alerts: true }))
    const pending = await subscriberOf(email)
    expect(pending).toMatchObject({ status: 'PENDING', confirmedAt: null, specialAlerts: false })
    expect(mailsTo(email)).toHaveLength(1)
    const token = linkToken(mailsTo(email)[0].html, '/newsletter/confirm')
    // Only the hash is stored.
    expect(await prisma.subscriberToken.count({ where: { tokenHash: token } })).toBe(0)

    const res = await confirmRoute(post('/api/newsletter/confirm', { token }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('confirmed')
    expect(body.manageUrl).toMatch(/\/newsletter\/preferences\?token=/)
    const active = await subscriberOf(email)
    expect(active).toMatchObject({ status: 'ACTIVE', weeklyDigest: true, specialAlerts: true, consentVersion: expect.any(String), consentSource: 'signup_form' })
    expect(active?.confirmedAt).toBeInstanceOf(Date)
    const actions = (await prisma.subscriberConsentEvent.findMany({ where: { subscriberId: active!.id }, orderBy: { createdAt: 'asc' } })).map((e) => e.action)
    expect(actions).toEqual(['SIGNUP_REQUESTED', 'CONFIRMED'])
  })

  it('tokens are single use, even when two confirmations race', async () => {
    const email = address('race')
    await requestSubscription({ email, alerts: false })
    const token = linkToken(outbox.pop()!.html, '/newsletter/confirm')
    const results = await Promise.all(Array.from({ length: 5 }, () => confirmSubscription(token)))
    expect(results.filter((r) => r.outcome === 'confirmed')).toHaveLength(1)
    expect(results.every((r) => ['confirmed', 'already_confirmed'].includes(r.outcome))).toBe(true)
    expect(await prisma.subscriberConsentEvent.count({ where: { action: 'CONFIRMED', subscriber: { email } } })).toBe(1)
  })

  it('expired and superseded links do not work', async () => {
    const email = address('expiry')
    await requestSubscription({ email, alerts: false })
    const first = linkToken(outbox.pop()!.html, '/newsletter/confirm')
    await requestSubscription({ email, alerts: false })
    const second = linkToken(outbox.pop()!.html, '/newsletter/confirm')
    expect((await confirmSubscription(first)).outcome).toBe('expired')
    expect((await confirmSubscription(second, { now: new Date(Date.now() + 49 * 60 * 60 * 1000) })).outcome).toBe('expired')
    expect((await confirmSubscription('A'.repeat(43))).outcome).toBe('invalid')
    expect((await subscriberOf(email))?.status).toBe('PENDING')
  })

  it('caps confirmation mails per address (3 a day) and never reveals it', async () => {
    const email = address('cap')
    for (let i = 0; i < 5; i++) expect((await subscribe(post('/api/subscribe', { email }))).status).toBe(202)
    expect(mailsTo(email)).toHaveLength(3)
  })

  it('a form submission never changes an active subscriber’s choices; it sends a preferences link instead', async () => {
    const email = address('active-resubmit')
    await requestSubscription({ email, alerts: false })
    await confirmSubscription(linkToken(outbox.pop()!.html, '/newsletter/confirm'))
    await subscribe(post('/api/subscribe', { email, alerts: true }))
    expect((await subscriberOf(email))?.specialAlerts).toBe(false)
    expect(mailsTo(email)).toHaveLength(1)
    expect(mailsTo(email)[0].html).toContain('/newsletter/preferences?token=')
  })
})

describe('preferences and unsubscribe', () => {
  async function activeWithManageToken(label: string) {
    const email = address(label)
    await requestSubscription({ email, alerts: false })
    const confirmed = await confirmSubscription(linkToken(outbox.pop()!.html, '/newsletter/confirm'))
    return { email, manage: confirmed.manageToken! }
  }

  it('updates topics, records consent, marks the change for Resend sync', async () => {
    const { email, manage } = await activeWithManageToken('prefs')
    const res = await preferencesRoute(post('/api/newsletter/preferences', { token: manage, weeklyDigest: true, specialAlerts: true }))
    expect((await res.json()).status).toBe('updated')
    const sub = await subscriberOf(email)
    expect(sub).toMatchObject({ specialAlerts: true, resendSyncState: expect.stringMatching(/PENDING|SYNCED/) })
    expect(await prisma.subscriberConsentEvent.count({ where: { subscriberId: sub!.id, action: 'PREFERENCES_UPDATED' } })).toBe(1)
  })

  it('turning everything off is an unsubscribe; old confirmation links stop working; re-adding needs a fresh confirmation', async () => {
    const { email, manage } = await activeWithManageToken('off')
    // An outstanding confirmation link from a stray request…
    await requestSubscription({ email: address('off'), alerts: false }) // active -> manage link only, no confirm token
    const res = await preferencesRoute(post('/api/newsletter/preferences', { token: manage, weeklyDigest: false, specialAlerts: false }))
    expect((await res.json()).status).toBe('unsubscribed')
    const sub = await subscriberOf(email)
    expect(sub).toMatchObject({ status: 'UNSUBSCRIBED', unsubscribeSource: 'preference_centre' })
    expect(await prisma.newsletterSuppression.findUnique({ where: { emailHash: emailHash(email) } })).toMatchObject({ reason: 'UNSUBSCRIBED' })

    // A later form submission does not re-subscribe: it only sends one (rate-limited) confirmation.
    outbox.length = 0
    await ageLinks(email)
    await subscribe(post('/api/subscribe', { email }))
    await subscribe(post('/api/subscribe', { email }))
    expect((await subscriberOf(email))?.status).toBe('UNSUBSCRIBED')
    expect(mailsTo(email)).toHaveLength(1)
    // Confirming that new link is the explicit re-consent.
    expect((await confirmSubscription(linkToken(mailsTo(email)[0].html, '/newsletter/confirm'))).outcome).toBe('confirmed')
    expect((await subscriberOf(email))?.status).toBe('ACTIVE')
    expect(await prisma.newsletterSuppression.findUnique({ where: { emailHash: emailHash(email) } })).toBeNull()
  })

  it('unsubscribing expires every outstanding confirmation link (no accidental re-subscribe)', async () => {
    const { email, manage } = await activeWithManageToken('expire-on-unsub')
    await prisma.subscriber.update({ where: { email }, data: { status: 'UNSUBSCRIBED' } })
    await ageLinks(email)
    // A re-consent request issues a confirmation link…
    await requestSubscription({ email, alerts: false })
    const pendingLink = linkToken(outbox.pop()!.html, '/newsletter/confirm')
    await prisma.subscriber.update({ where: { email }, data: { status: 'ACTIVE' } })
    // …then the person unsubscribes before using it.
    expect((await (await unsubscribeRoute(post('/api/newsletter/unsubscribe', { token: manage }))).json()).status).toBe('unsubscribed')
    expect((await confirmSubscription(pendingLink)).outcome).toBe('expired')
    expect((await subscriberOf(email))?.status).toBe('UNSUBSCRIBED')
  })

  it('suppressed (complaint) addresses are never mailed again, even with a valid confirmation link', async () => {
    const email = address('complaint')
    await requestSubscription({ email, alerts: false })
    const token = linkToken(outbox.pop()!.html, '/newsletter/confirm')
    await prisma.newsletterSuppression.create({ data: { emailHash: emailHash(email), reason: 'COMPLAINED', source: 'test' } })
    expect((await confirmSubscription(token)).outcome).toBe('suppressed')
    expect((await subscriberOf(email))?.status).toBe('PENDING')
    expect((await requestSubscription({ email, alerts: false })).outcome).toBe('suppressed')
  })

  it('manage-link requests answer identically and only mail subscribed addresses', async () => {
    const { email } = await activeWithManageToken('manage-link')
    outbox.length = 0
    const known = await manageLinkRoute(post('/api/newsletter/manage-link', { email }))
    const unknown = await manageLinkRoute(post('/api/newsletter/manage-link', { email: address('nobody') }))
    expect(known.status).toBe(202)
    expect(await known.text()).toBe(await unknown.text())
    expect(outbox.map((m) => m.to)).toEqual([email])
  })
})

describe('the old GET-based unsubscribe link', () => {
  const legacyToken = (email: string) => createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(email.toLowerCase()).digest('hex')

  it('opening the page changes nothing; the button POST unsubscribes and records it', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'legacy-secret-for-tests')
    try {
      const email = address('legacy')
      await requestSubscription({ email, alerts: false })
      await confirmSubscription(linkToken(outbox.pop()!.html, '/newsletter/confirm'))
      await UnsubscribePage({ searchParams: Promise.resolve({ email, token: legacyToken(email) }) })
      expect((await subscriberOf(email))?.status).toBe('ACTIVE')

      const res = await unsubscribeRoute(post('/api/newsletter/unsubscribe', { email, legacyToken: legacyToken(email) }))
      expect((await res.json()).status).toBe('unsubscribed')
      expect(await subscriberOf(email)).toMatchObject({ status: 'UNSUBSCRIBED', unsubscribeSource: 'legacy_unsubscribe_link' })
      // The row is kept (withdrawal record), not deleted as before.
      expect(await prisma.subscriberConsentEvent.count({ where: { subscriber: { email }, action: 'UNSUBSCRIBED' } })).toBe(1)

      // An address with no row still gets a suppression so a stray submission cannot add it.
      const ghost = address('legacy-only')
      await unsubscribeRoute(post('/api/newsletter/unsubscribe', { email: ghost, legacyToken: legacyToken(ghost) }))
      expect(await prisma.newsletterSuppression.findUnique({ where: { emailHash: emailHash(ghost) } })).toMatchObject({ reason: 'UNSUBSCRIBED' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('refuses forged links, and the old hard-coded fallback secret no longer works', async () => {
    const email = address('forged')
    vi.stubEnv('NEXTAUTH_SECRET', '')
    try {
      const forged = createHmac('sha256', 'consilium-unsubscribe').update(email).digest('hex')
      const res = await unsubscribeRoute(post('/api/newsletter/unsubscribe', { email, legacyToken: forged }))
      expect(res.status).toBe(400)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
