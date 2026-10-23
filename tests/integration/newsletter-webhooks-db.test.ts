/**
 * Resend webhook receiver against a real (local, disposable) database: signature, idempotency, unsubscribe
 * and suppression sync, refusal to re-subscribe, out-of-order events, delivery counters, retries.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { POST as webhook } from '@/app/api/webhooks/resend/route'
import { createMemoryProvider, setMarketingProviderForTests, type MemoryProvider } from '@/lib/newsletter/provider'
import { requestSubscription } from '@/lib/newsletter/subscriptions'
import { retryWebhookEvents } from '@/lib/newsletter/webhooks'
import { emailHash } from '@/lib/newsletter/identity'

assertSafeTestDatabaseHost(process.env.TEST_DATABASE_URL!, 'TEST_DATABASE_URL')

const RUN = randomUUID().slice(0, 8)
const KEY = randomBytes(24)
const email = (label: string) => `${label}-${RUN}@newsletter.test`
let provider: MemoryProvider
let counter = 0

function signed(payload: unknown, id = `msg_${RUN}_${++counter}`) {
  const body = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const signature = `v1,${createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64')}`
  return { id, request: () => new Request('http://localhost/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': signature }, body }) }
}

async function active(label: string, prefs: { weeklyDigest?: boolean; specialAlerts?: boolean } = {}) {
  return prisma.subscriber.create({
    data: { email: email(label), status: 'ACTIVE', confirmedAt: new Date(), weeklyDigest: prefs.weeklyDigest ?? true, specialAlerts: prefs.specialAlerts ?? false, resendContactId: `contact_${label}_${RUN}`, resendSyncState: 'SYNCED' },
  })
}

const contactEvent = (type: string, sub: { email: string; resendContactId: string | null }, data: Record<string, unknown>) => ({
  type,
  created_at: new Date().toISOString(),
  data: { id: sub.resendContactId, email: sub.email, audience_id: 'a', segment_ids: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), unsubscribed: false, ...data },
})

beforeAll(() => {
  vi.stubEnv('RESEND_WEBHOOK_SECRET', `whsec_${KEY.toString('base64')}`)
})

beforeEach(() => {
  provider = createMemoryProvider()
  setMarketingProviderForTests(provider)
})

afterAll(async () => {
  const subs = await prisma.subscriber.findMany({ where: { email: { endsWith: '@newsletter.test' } }, select: { id: true, email: true } })
  await prisma.subscriberConsentEvent.deleteMany({ where: { OR: [{ subscriberId: { in: subs.map((s) => s.id) } }, { emailHash: { in: subs.map((s) => emailHash(s.email)) } }] } })
  await prisma.subscriber.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } })
  await prisma.newsletterSuppression.deleteMany({ where: { emailHash: { in: subs.map((s) => emailHash(s.email)) } } })
  await prisma.newsletterWebhookEvent.deleteMany({ where: { id: { startsWith: `msg_${RUN}` } } })
  await prisma.$executeRawUnsafe(`ALTER TABLE newsletter_campaigns DISABLE TRIGGER newsletter_campaigns_protect`)
  await prisma.newsletterCampaign.deleteMany({ where: { editionKey: 'weekly:2045-01-06' } })
  await prisma.$executeRawUnsafe(`ALTER TABLE newsletter_campaigns ENABLE TRIGGER newsletter_campaigns_protect`)
  setMarketingProviderForTests(null)
  vi.unstubAllEnvs()
})

describe('webhook authentication and idempotency', () => {
  it('refuses unsigned or mis-signed deliveries and stores nothing', async () => {
    const before = await prisma.newsletterWebhookEvent.count()
    const res = await webhook(new Request('http://localhost/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': 'x', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,AAAA' }, body: '{"type":"email.complained"}' }))
    expect(res.status).toBe(401)
    expect(await prisma.newsletterWebhookEvent.count()).toBe(before)
  })

  it('a resend-side unsubscribe is applied once, however often Resend redelivers it', async () => {
    const sub = await active('unsub')
    const delivery = signed(contactEvent('contact.updated', sub, { unsubscribed: true }))
    const first = await webhook(delivery.request())
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ received: true, duplicate: false })
    const again = await webhook(delivery.request())
    expect(await again.json()).toMatchObject({ received: true, duplicate: true })
    expect(await prisma.subscriber.findUnique({ where: { id: sub.id } })).toMatchObject({ status: 'UNSUBSCRIBED', unsubscribeSource: 'resend_webhook' })
    expect(await prisma.subscriberConsentEvent.count({ where: { subscriberId: sub.id, action: 'UNSUBSCRIBED' } })).toBe(1)
    expect(await prisma.newsletterSuppression.findUnique({ where: { emailHash: emailHash(sub.email) } })).toMatchObject({ reason: 'UNSUBSCRIBED' })
  })
})

describe('contact events', () => {
  it('never re-subscribes from Resend: our withdrawn state is pushed back instead', async () => {
    const sub = await active('no-resub')
    await prisma.subscriber.update({ where: { id: sub.id }, data: { status: 'UNSUBSCRIBED', resendSyncState: 'SYNCED' } })
    await webhook(signed(contactEvent('contact.updated', sub, { unsubscribed: false })).request())
    expect(await prisma.subscriber.findUnique({ where: { id: sub.id } })).toMatchObject({ status: 'UNSUBSCRIBED', resendSyncState: 'PENDING' })
    expect(await prisma.subscriberConsentEvent.count({ where: { subscriberId: sub.id, action: 'RESUBSCRIBE_REFUSED' } })).toBe(1)
  })

  it('applies topic changes made on Resend’s preference page (fetched from Resend)', async () => {
    const sub = await active('topics', { specialAlerts: true })
    await provider.syncContact({ email: sub.email, subscribed: true, topics: { weekly: true, alerts: false } })
    await webhook(signed(contactEvent('contact.updated', sub, { unsubscribed: false })).request())
    expect(await prisma.subscriber.findUnique({ where: { id: sub.id } })).toMatchObject({ status: 'ACTIVE', weeklyDigest: true, specialAlerts: false, resendSyncState: 'SYNCED' })
    const event = await prisma.subscriberConsentEvent.findFirst({ where: { subscriberId: sub.id, action: 'PREFERENCES_UPDATED' } })
    expect(event).toMatchObject({ source: 'resend_webhook', specialAlerts: false })
  })

  it('ignores an event older than one already applied', async () => {
    const sub = await active('order')
    const newer = new Date()
    const older = new Date(newer.getTime() - 60_000)
    await prisma.subscriber.update({ where: { id: sub.id }, data: { resendUpdatedAt: newer } })
    await webhook(signed(contactEvent('contact.updated', sub, { unsubscribed: true, updated_at: older.toISOString() })).request())
    expect((await prisma.subscriber.findUnique({ where: { id: sub.id } }))?.status).toBe('ACTIVE')
  })

  it('a contact deleted in Resend is treated as a withdrawal (fail safe)', async () => {
    const sub = await active('deleted')
    await webhook(signed(contactEvent('contact.deleted', sub, {})).request())
    expect(await prisma.subscriber.findUnique({ where: { id: sub.id } })).toMatchObject({ status: 'UNSUBSCRIBED', resendContactId: null })
  })

  it('a processing failure answers 500 (Resend retries) and the tick reconciles it later', async () => {
    const sub = await active('retry', { specialAlerts: true })
    setMarketingProviderForTests(null) // the provider is unavailable: topics cannot be fetched
    const delivery = signed(contactEvent('contact.updated', sub, { unsubscribed: false }))
    const res = await webhook(delivery.request())
    expect(res.status).toBe(500)
    expect(await prisma.newsletterWebhookEvent.findUnique({ where: { id: delivery.id } })).toMatchObject({ status: 'FAILED', attempts: 1 })
    setMarketingProviderForTests(provider)
    await provider.syncContact({ email: sub.email, subscribed: true, topics: { weekly: false, alerts: true } })
    await retryWebhookEvents()
    expect(await prisma.newsletterWebhookEvent.findUnique({ where: { id: delivery.id } })).toMatchObject({ status: 'PROCESSED', attempts: 2 })
    expect(await prisma.subscriber.findUnique({ where: { id: sub.id } })).toMatchObject({ weeklyDigest: false, specialAlerts: true })
  })
})

describe('deliverability events', () => {
  const emailEvent = (type: string, to: string, extra: Record<string, unknown> = {}) => ({ type, created_at: new Date().toISOString(), data: { email_id: 'e1', from: 'x', to: [to], subject: 's', created_at: new Date().toISOString(), ...extra } })

  it('hard bounces and complaints suppress; soft bounces do not; suppressed addresses cannot sign up again', async () => {
    const hard = await active('hard')
    const soft = await active('soft')
    const complaint = await active('complaint')
    await webhook(signed(emailEvent('email.bounced', hard.email, { bounce: { type: 'Permanent', subType: 'General', message: 'no such user' } })).request())
    await webhook(signed(emailEvent('email.bounced', soft.email, { bounce: { type: 'Transient', subType: 'MailboxFull', message: 'full' } })).request())
    await webhook(signed(emailEvent('email.complained', complaint.email.toUpperCase())).request())
    expect((await prisma.subscriber.findUnique({ where: { id: hard.id } }))?.status).toBe('SUPPRESSED')
    expect((await prisma.subscriber.findUnique({ where: { id: soft.id } }))?.status).toBe('ACTIVE')
    expect(await prisma.subscriber.findUnique({ where: { id: complaint.id } })).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'COMPLAINED', resendSyncState: 'PENDING' })
    expect((await prisma.newsletterSuppression.findUnique({ where: { emailHash: emailHash(complaint.email) } }))?.reason).toBe('COMPLAINED')
    expect((await requestSubscription({ email: complaint.email, alerts: false })).outcome).toBe('suppressed')
  })

  it('counts deliveries, bounces and complaints against the sent campaign', async () => {
    const campaign = await prisma.newsletterCampaign.create({
      data: { kind: 'WEEKLY', editionKey: 'weekly:2045-01-06', status: 'SENT', subject: 's', articles: {}, contentHash: 'h', approvedHash: 'h', approvedAt: new Date(), scheduledFor: new Date(), sentAt: new Date(), resendBroadcastId: `b_${RUN}` },
    })
    await webhook(signed(emailEvent('email.delivered', email('reader1'), { broadcast_id: `b_${RUN}` })).request())
    await webhook(signed(emailEvent('email.delivered', email('reader2'), { broadcast_id: `b_${RUN}` })).request())
    await webhook(signed(emailEvent('email.opened', email('reader2'), { broadcast_id: `b_${RUN}` })).request())
    expect(await prisma.newsletterCampaign.findUnique({ where: { id: campaign.id } })).toMatchObject({ deliveredCount: 2, bouncedCount: 0 })
    // Opens are not stored as anything but an ignored delivery record.
    expect(await prisma.newsletterWebhookEvent.count({ where: { type: 'email.opened', id: { startsWith: `msg_${RUN}` }, status: 'IGNORED' } })).toBe(1)
  })
})
