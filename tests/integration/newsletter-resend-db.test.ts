/**
 * The REAL Resend provider code (pagination, retries, timeouts, create-or-update, topics) against a faithful
 * fake of the Resend API (tests/helpers/fakeResend.ts) and a real local database:
 *   - 1,300 subscriber rows (1,050+ confirmed) across 11+ pages: nobody missed, nobody extra, every topic preference honoured,
 *     with 429s sprinkled through, and without send failures;
 *   - drift found by the topic audit is resolved safely (never re-opting anyone in);
 *   - no duplicate newsletter after a lost response, a timeout, a crash at any point, list lag, or a stale
 *     worker; broadcast ids are persisted and Resend's state is reconciled before any retry;
 *   - Resend's global unsubscribe, topic preferences and one-click unsubscribe, end to end through the
 *     signed webhook route.
 * Nothing leaves the process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { NewsletterCampaign } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { FakeResend } from '../helpers/fakeResend'
import { createResendMarketingProvider, setMarketingProviderForTests, type MarketingProvider } from '@/lib/newsletter/provider'
import { broadcastName, runDueCampaigns, sendClaimedForTests } from '@/lib/newsletter/campaigns'
import { buildAlertContent, contentHash, type EditionItem } from '@/lib/newsletter/edition'
import { currentWeeklySlot } from '@/lib/newsletter/schedule'
import { PAUSE_SETTING_KEY } from '@/lib/newsletter/settings'
import { syncPendingSubscribers } from '@/lib/newsletter/sync'
import { confirmSubscription, requestSubscription, updatePreferences } from '@/lib/newsletter/subscriptions'
import { POST as webhook } from '@/app/api/webhooks/resend/route'
import type { ResendMarketingConfig } from '@/lib/newsletter/config'

assertSafeTestDatabaseHost(process.env.TEST_DATABASE_URL!, 'TEST_DATABASE_URL')

const RUN = randomUUID().slice(0, 8)
const MIN = 60_000
const DAY = 24 * 60 * MIN
const CONFIG: ResendMarketingConfig = {
  mode: 'resend',
  apiKey: 're_fake_marketing',
  segmentId: 'seg_newsletter',
  weeklyTopicId: 'topic_weekly',
  alertsTopicId: 'topic_alerts',
  from: 'The Consilium <newsletter@theconsilium.co.uk>',
  siteUrl: 'https://www.theconsilium.co.uk',
}
const WEBHOOK_KEY = randomBytes(24)
// A Tuesday, well away from Friday's edition (alert caps) and in the future (no seeded data in the window).
const TUESDAY = new Date(currentWeeklySlot(new Date('2035-06-01T12:00:00Z')).sendAt.getTime() + 4 * DAY - 6 * 60 * MIN)

let fake: FakeResend
let provider: MarketingProvider
let articleId = ''
let item: EditionItem

const email = (label: string) => `${label}-${RUN}@newsletter.test`

function freshResend(options: { requestTimeoutMs?: number } = {}) {
  fake = new FakeResend({ topic_weekly: 'opt_out', topic_alerts: 'opt_out' })
  provider = createResendMarketingProvider(CONFIG, { client: fake as never, minIntervalMs: 0, retryBaseMs: 1, requestTimeoutMs: options.requestTimeoutMs ?? 2_000 })
  setMarketingProviderForTests(provider)
}

async function resetData() {
  await prisma.$executeRawUnsafe(`ALTER TABLE newsletter_campaigns DISABLE TRIGGER newsletter_campaigns_protect`)
  await prisma.newsletterCampaign.deleteMany({})
  await prisma.$executeRawUnsafe(`ALTER TABLE newsletter_campaigns ENABLE TRIGGER newsletter_campaigns_protect`)
  const subs = await prisma.subscriber.findMany({ where: { email: { endsWith: '@newsletter.test' } }, select: { id: true } })
  await prisma.subscriberConsentEvent.deleteMany({ where: { subscriberId: { in: subs.map((s) => s.id) } } })
  await prisma.subscriber.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } })
}

async function scheduled(kind: 'WEEKLY' | 'ALERT', at: Date): Promise<NewsletterCampaign> {
  const subject = kind === 'WEEKLY' ? 'The Weekly Edition: test' : 'Special article: test'
  const hash = contentHash({ subject, previewText: null, intro: null, items: [item] })
  return prisma.newsletterCampaign.create({
    data: {
      kind,
      editionKey: kind === 'WEEKLY' ? currentWeeklySlot(at).editionKey : `alert:${articleId}`,
      articleId: kind === 'ALERT' ? articleId : null,
      status: 'SCHEDULED',
      subject,
      articles: { items: [item], excluded: [] } as never,
      contentHash: hash,
      approvedHash: hash,
      approvedAt: at,
      approvedByName: 'Test Admin',
      scheduledFor: at,
    },
  })
}

const activeEmails = async (topic: 'weeklyDigest' | 'specialAlerts') =>
  (await prisma.subscriber.findMany({ where: { status: 'ACTIVE', [topic]: true, email: { endsWith: '@newsletter.test' } }, select: { email: true } })).map((s) => s.email).sort()

function signed(payload: unknown) {
  const id = `msg_${RUN}_${randomUUID().slice(0, 8)}`
  const body = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const signature = `v1,${createHmac('sha256', WEBHOOK_KEY).update(`${id}.${ts}.${body}`).digest('base64')}`
  return new Request('http://localhost/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': signature }, body })
}

beforeAll(async () => {
  vi.stubEnv('RESEND_WEBHOOK_SECRET', `whsec_${WEBHOOK_KEY.toString('base64')}`)
  const author = await prisma.user.findFirstOrThrow({ where: { role: { in: ['WRITER', 'ADMIN'] } }, select: { id: true } })
  const article = await prisma.article.create({
    data: { title: `NL-${RUN} Resend fixture`, slug: `nl-${RUN}-resend-fixture`, content: '<p>x</p>', excerpt: 'A published summary.', authorId: author.id, status: 'PUBLISHED', publishedAt: new Date('2030-01-01T09:00:00Z') },
  })
  articleId = article.id
  item = (await buildAlertContent(articleId)) as EditionItem
  await prisma.siteSetting.upsert({ where: { key: PAUSE_SETTING_KEY }, create: { key: PAUSE_SETTING_KEY, value: 'false' }, update: { value: 'false' } })
})

beforeEach(async () => {
  await resetData()
  freshResend()
})

afterAll(async () => {
  await resetData()
  await prisma.article.deleteMany({ where: { id: articleId } })
  await prisma.siteSetting.deleteMany({ where: { key: PAUSE_SETTING_KEY } })
  await prisma.newsletterWebhookEvent.deleteMany({ where: { id: { startsWith: `msg_${RUN}` } } })
  setMarketingProviderForTests(null)
  vi.unstubAllEnvs()
})

// ── scale ───────────────────────────────────────────────────────────────────

async function populate(total: number) {
  const rows = Array.from({ length: total }, (_, i) => {
    const kind = i % 21 // deterministic mix
    const status = kind === 0 ? 'PENDING' : kind === 1 ? 'LEGACY' : kind === 2 ? 'UNSUBSCRIBED' : kind === 3 ? 'SUPPRESSED' : 'ACTIVE'
    return {
      email: email(`bulk${String(i).padStart(4, '0')}`),
      status: status as 'ACTIVE',
      confirmedAt: status === 'ACTIVE' || status === 'UNSUBSCRIBED' || status === 'SUPPRESSED' ? new Date('2034-01-01T00:00:00Z') : null,
      weeklyDigest: kind % 5 !== 4, // some alerts-only
      specialAlerts: kind % 3 === 0 || kind % 5 === 4,
      resendSyncState: 'PENDING' as const,
    }
  })
  await prisma.subscriber.createMany({ data: rows })
  return rows
}

describe('over 1,000 confirmed subscribers (1,300 rows in every state)', () => {
  it('syncs every page, sends to exactly the right people per topic, with 429s and no failures', async () => {
    await populate(1300)
    // Pre-existing state in Resend: strays that must be switched off, and existing contacts (409 path).
    for (let i = 0; i < 30; i++) await fake.contacts.create({ email: email(`stray${i}`), unsubscribed: false, segments: [{ id: CONFIG.segmentId }], topics: [{ id: 'topic_weekly', subscription: 'opt_in' }, { id: 'topic_alerts', subscription: 'opt_in' }] })
    for (let i = 4; i < 24; i++) await fake.contacts.create({ email: email(`bulk${String(i).padStart(4, '0')}`), unsubscribed: true, segments: [], topics: [] })
    fake.calls.length = 0
    fake.rateLimitEvery = 37

    const weekly = await scheduled('WEEKLY', TUESDAY)
    const report = await runDueCampaigns(TUESDAY)
    expect(report.results).toEqual([expect.objectContaining({ id: weekly.id, outcome: 'sent' })])

    const expectedWeekly = await activeEmails('weeklyDigest')
    expect(expectedWeekly.length).toBeGreaterThan(800)
    expect(await prisma.subscriber.count({ where: { status: 'ACTIVE', email: { endsWith: '@newsletter.test' } } })).toBeGreaterThan(1000)
    const [broadcast] = fake.sent()
    expect(broadcast.recipients).toEqual(expectedWeekly)
    expect(broadcast.topicId).toBe('topic_weekly')
    expect(fake.count('contacts.list')).toBeGreaterThanOrEqual(11) // > 1,000 segment contacts = 11+ pages
    expect(fake.audience(CONFIG.segmentId, 'topic_weekly').filter((e) => e.includes('stray'))).toEqual([])
    expect(fake.count('broadcasts.send')).toBe(1)
    expect(await prisma.subscriber.count({ where: { email: { endsWith: '@newsletter.test' }, resendSyncState: { not: 'SYNCED' } } })).toBe(0)
    expect(await prisma.subscriber.count({ where: { status: 'ACTIVE', resendVerifiedAt: null, email: { endsWith: '@newsletter.test' } } })).toBe(0)
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: weekly.id } })).recipientCount).toBe(expectedWeekly.length)

    // The alerts topic reaches exactly the alerts subscribers (13 h later: alerts keep 12 h clear of an edition).
    const later = new Date(TUESDAY.getTime() + 13 * 60 * MIN)
    const alert = await scheduled('ALERT', later)
    expect((await runDueCampaigns(later)).results).toEqual([expect.objectContaining({ id: alert.id, outcome: 'sent' })])
    expect(fake.sent().find((b) => b.topicId === 'topic_alerts')?.recipients).toEqual(await activeEmails('specialAlerts'))
  }, 120_000)

  it('the topic audit covers everyone (no size cap) and resolves drift without opting anyone in', async () => {
    await populate(1300)
    await syncPendingSubscribers(provider, { deadline: Date.now() + 60_000 })
    const active = await prisma.subscriber.findMany({ where: { status: 'ACTIVE', email: { endsWith: '@newsletter.test' } }, orderBy: { email: 'asc' } })
    const permissive = active.filter((s) => !s.specialAlerts).slice(0, 40) // Resend says alerts opt_in, we say no
    const withdrewTopic = active.filter((s) => s.weeklyDigest && s.specialAlerts).slice(0, 25) // weekly withdrawn on Resend's page
    const withdrewAll = active.filter((s) => s.weeklyDigest && !s.specialAlerts).slice(40, 45) // global unsubscribe, webhook lost
    for (const s of permissive) fake.contactsById.get(s.resendContactId!)!.topics.set('topic_alerts', 'opt_in')
    for (const s of withdrewTopic) fake.contactsById.get(s.resendContactId!)!.topics.set('topic_weekly', 'opt_out')
    for (const s of withdrewAll) fake.contactsById.get(s.resendContactId!)!.unsubscribed = true
    // Everyone's verification is stale, so the send must re-verify all of them.
    await prisma.subscriber.updateMany({ where: { email: { endsWith: '@newsletter.test' } }, data: { resendVerifiedAt: new Date('2000-01-01T00:00:00Z') } })

    await scheduled('ALERT', TUESDAY)
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.count('contacts.topics.list')).toBeGreaterThanOrEqual(active.length - withdrewAll.length)
    const recipients = fake.sent()[0].recipients!
    for (const s of permissive) expect(recipients).not.toContain(s.email)
    expect(recipients).toEqual(await activeEmails('specialAlerts'))
    // Withdrawals made in Resend were adopted here, with a consent record; nobody was opted back in.
    for (const s of withdrewTopic) expect(await prisma.subscriber.findUnique({ where: { id: s.id } })).toMatchObject({ weeklyDigest: false, specialAlerts: true })
    for (const s of withdrewAll) expect((await prisma.subscriber.findUnique({ where: { id: s.id } }))?.status).toBe('UNSUBSCRIBED')
    for (const s of withdrewTopic) expect(fake.effective(fake.contactsById.get(s.resendContactId!)!, 'topic_weekly')).toBe('opt_out')
    expect(await prisma.subscriberConsentEvent.count({ where: { subscriberId: { in: withdrewTopic.map((s) => s.id) }, action: 'PREFERENCES_UPDATED' } })).toBe(withdrewTopic.length)
  }, 120_000)

  it('when verification cannot finish in time the send WAITS (no attempt used, nothing created), then completes', async () => {
    await populate(300)
    await syncPendingSubscribers(provider, { deadline: Date.now() + 60_000 })
    await prisma.subscriber.updateMany({ where: { email: { endsWith: '@newsletter.test' } }, data: { resendVerifiedAt: new Date('2000-01-01T00:00:00Z') } })
    const campaign = await scheduled('WEEKLY', TUESDAY)
    const waiting = await runDueCampaigns(TUESDAY, { audienceBudgetMs: 0 })
    expect(waiting.results).toEqual([expect.objectContaining({ outcome: 'waiting', detail: expect.stringMatching(/awaiting topic verification/) })])
    expect(await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ status: 'SCHEDULED', sendAttempts: 0, resendBroadcastId: null })
    expect(fake.count('broadcasts.create')).toBe(0)
    expect((await runDueCampaigns(new Date(TUESDAY.getTime() + MIN))).results.map((r) => r.outcome)).toEqual(['sent'])
  }, 120_000)
})

// ── exactly once ────────────────────────────────────────────────────────────

async function oneSubscriber() {
  await prisma.subscriber.create({ data: { email: email('reader'), status: 'ACTIVE', confirmedAt: new Date(), weeklyDigest: true, resendSyncState: 'PENDING' } })
}

describe('no duplicate newsletter, whatever goes wrong', () => {
  const after = (minutes: number) => new Date(TUESDAY.getTime() + minutes * MIN)

  it('create: response lost after Resend created it -> found by name, reused, sent once', async () => {
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    fake.inject('broadcasts.create', { kind: 'lost-response' })
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['uncertain'])
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).resendBroadcastId).toBeNull()
    expect((await runDueCampaigns(after(5))).results).toEqual([]) // lease held
    expect((await runDueCampaigns(after(11))).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.count('broadcasts.create')).toBe(1)
    expect(fake.sent()).toHaveLength(1)
  })

  it('create: timeout -> the same reconciliation; Resend never answers', async () => {
    freshResend({ requestTimeoutMs: 50 })
    await oneSubscriber()
    await scheduled('WEEKLY', TUESDAY)
    fake.inject('broadcasts.create', { kind: 'timeout' })
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['uncertain'])
    expect((await runDueCampaigns(after(11))).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.sent()).toHaveLength(1)
  })

  it('create lost AND Resend’s list lags: a second draft may be created, but only one broadcast is ever sent', async () => {
    await oneSubscriber()
    await scheduled('WEEKLY', TUESDAY)
    fake.listLagCalls = 50
    fake.inject('broadcasts.create', { kind: 'lost-response' })
    await runDueCampaigns(TUESDAY)
    expect((await runDueCampaigns(after(11))).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.count('broadcasts.create')).toBe(2)
    expect(fake.sent()).toHaveLength(1)
    expect([...fake.broadcastsById.values()].filter((b) => b.status === 'draft')).toHaveLength(1) // orphan, never sent
  })

  it('send: Resend sent it but the response was lost -> reconciled as sent, no second request', async () => {
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    fake.inject('broadcasts.send', { kind: 'lost-response' })
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['uncertain'])
    const pending = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })
    expect(pending).toMatchObject({ status: 'SENDING', resendBroadcastId: expect.any(String) })
    expect(pending.sendRequestedAt).toBeInstanceOf(Date)
    expect((await runDueCampaigns(after(11))).results.map((r) => r.outcome)).toEqual(['already_sent'])
    expect(fake.count('broadcasts.send')).toBe(1)
    expect(fake.sent()).toHaveLength(1)
  })

  it('send: timeout and Resend did NOT send -> waits out the settle window, then sends that same broadcast once', async () => {
    freshResend({ requestTimeoutMs: 50 })
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    fake.inject('broadcasts.send', { kind: 'timeout' })
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['uncertain'])
    const { resendBroadcastId, sendRequestedAt } = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })
    // Lease expired but the settle window has not: a "draft" answer is not trusted yet.
    const settleCheck = new Date(sendRequestedAt!.getTime() + 11 * MIN)
    expect((await runDueCampaigns(settleCheck)).results.map((r) => r.outcome)).toEqual(['uncertain'])
    expect(fake.sent()).toHaveLength(0)
    const later = new Date(sendRequestedAt!.getTime() + 16 * MIN)
    expect((await runDueCampaigns(later)).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.sent().map((b) => b.id)).toEqual([resendBroadcastId])
    expect(fake.count('broadcasts.create')).toBe(1)
  })

  it('crash after creating, before the id was saved -> recovered by name', async () => {
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    const orphan = await provider.createBroadcast({ name: broadcastName(c), subject: c.subject, html: 'h', text: 't', topic: 'weekly' })
    await prisma.newsletterCampaign.update({ where: { id: c.id }, data: { status: 'SENDING', sendAttempts: 1, leaseUntil: new Date(TUESDAY.getTime() - MIN) } })
    fake.calls.length = 0
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.count('broadcasts.create')).toBe(0)
    expect(fake.sent().map((b) => b.id)).toEqual([orphan.id])
  })

  it('crash after Resend sent it, before we recorded it -> reconciled, never re-sent', async () => {
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    const b = await provider.createBroadcast({ name: broadcastName(c), subject: c.subject, html: 'h', text: 't', topic: 'weekly' })
    await provider.sendBroadcast(b.id)
    await prisma.newsletterCampaign.update({ where: { id: c.id }, data: { status: 'SENDING', sendAttempts: 1, resendBroadcastId: b.id, sendRequestedAt: TUESDAY, leaseUntil: new Date(TUESDAY.getTime() - MIN) } })
    fake.calls.length = 0
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['already_sent'])
    expect(fake.count('broadcasts.send')).toBe(0)
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('SENT')
  })

  it('a stale worker whose lease expired cannot save an id, send or record anything', async () => {
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    // Worker A claims, then stalls (we hold its snapshot without letting it run).
    await prisma.newsletterCampaign.update({ where: { id: c.id }, data: { status: 'SENDING', sendAttempts: 1, leaseUntil: new Date(TUESDAY.getTime() + 10 * MIN) } })
    const workerA = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })
    // A's lease expires; worker B takes over and sends.
    expect((await runDueCampaigns(after(11))).results.map((r) => r.outcome)).toEqual(['sent'])
    // A wakes up and carries on with its stale snapshot.
    expect((await sendClaimedForTests(workerA, provider, after(12), { fetchLinks: false })).outcome).toMatch(/superseded|already_sent/)
    expect(fake.count('broadcasts.create')).toBe(1)
    expect(fake.sent()).toHaveLength(1)
  })

  it('Resend refusing a send because it already went is recorded as sent', async () => {
    await oneSubscriber()
    const c = await scheduled('WEEKLY', TUESDAY)
    fake.inject('broadcasts.get', { kind: 'error', status: 500 }) // first status check fails…
    await runDueCampaigns(TUESDAY) // -> failed attempt before any send
    const row = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })
    // Someone (another region, an operator) sent the broadcast meanwhile.
    if (row.resendBroadcastId) await provider.sendBroadcast(row.resendBroadcastId)
    const retry = await runDueCampaigns(new Date(row.nextAttemptAt?.getTime() ?? after(11).getTime()))
    expect(retry.results.map((r) => r.outcome)).toEqual([expect.stringMatching(/already_sent|sent/)])
    expect(fake.sent()).toHaveLength(1)
  })
})

// ── Resend-side subscription behaviour ──────────────────────────────────────

describe('global unsubscribe, topics and one-click unsubscribe (Resend semantics)', () => {
  async function confirmedReader(label: string, alerts: boolean) {
    const requested = await requestSubscription({ email: email(label), alerts })
    const token = /token=([A-Za-z0-9_-]{43})/.exec(requested.mail!.html)![1]
    const confirmed = await confirmSubscription(token)
    await syncPendingSubscribers(provider, { deadline: Date.now() + 10_000 })
    return confirmed.manageToken!
  }

  it('a new contact is created opted in to exactly its topics (topic defaults are opt-out)', async () => {
    await confirmedReader('topics-new', false)
    const contact = [...fake.contactsById.values()].find((c) => c.email === email('topics-new'))!
    expect(contact.unsubscribed).toBe(false)
    expect(fake.effective(contact, 'topic_weekly')).toBe('opt_in')
    expect(fake.effective(contact, 'topic_alerts')).toBe('opt_out')
    expect(contact.segments.has(CONFIG.segmentId)).toBe(true)
  })

  it('one-click unsubscribe (List-Unsubscribe-Post) is global, reaches us by webhook, and the next edition skips them', async () => {
    await confirmedReader('one-click', true)
    await confirmedReader('stays', false)
    const res = await webhook(signed(fake.oneClickUnsubscribe(email('one-click'))))
    expect(res.status).toBe(200)
    expect(await prisma.subscriber.findFirst({ where: { email: email('one-click') } })).toMatchObject({ status: 'UNSUBSCRIBED', unsubscribeSource: 'resend_webhook' })
    await scheduled('WEEKLY', TUESDAY)
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.sent()[0].recipients).toEqual([email('stays')])
  })

  it('the global flag overrides topics: unsubscribed with topics still opted in receives nothing', async () => {
    await confirmedReader('override', true)
    const contact = [...fake.contactsById.values()].find((c) => c.email === email('override'))!
    contact.unsubscribed = true // e.g. changed in Resend, webhook lost: topics still say opt_in
    expect(fake.effective(contact, 'topic_weekly')).toBe('opt_in')
    expect(fake.audience(CONFIG.segmentId, 'topic_weekly')).not.toContain(email('override'))
    await scheduled('WEEKLY', TUESDAY)
    await runDueCampaigns(TUESDAY)
    // The reconciliation adopted the withdrawal here too.
    expect((await prisma.subscriber.findFirst({ where: { email: email('override') } }))?.status).toBe('UNSUBSCRIBED')
  })

  it('a topic opt-out on Resend’s preference page keeps the other topic', async () => {
    await confirmedReader('topic-page', true)
    await webhook(signed(fake.setTopicOnPreferencePage(email('topic-page'), 'topic_weekly', 'opt_out')))
    expect(await prisma.subscriber.findFirst({ where: { email: email('topic-page') } })).toMatchObject({ status: 'ACTIVE', weeklyDigest: false, specialAlerts: true })
    await scheduled('WEEKLY', TUESDAY)
    expect((await runDueCampaigns(TUESDAY)).results.map((r) => r.outcome)).toEqual(['skipped_no_recipients'])
    await scheduled('ALERT', new Date(TUESDAY.getTime() + MIN))
    expect((await runDueCampaigns(new Date(TUESDAY.getTime() + 2 * MIN))).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(fake.sent()[0].recipients).toEqual([email('topic-page')])
  })

  it('changes in our preference centre reach Resend; turning everything off unsubscribes globally there too', async () => {
    const manage = await confirmedReader('centre', false)
    await updatePreferences(manage, { weeklyDigest: true, specialAlerts: true })
    await syncPendingSubscribers(provider, { deadline: Date.now() + 10_000 })
    const contact = () => [...fake.contactsById.values()].find((c) => c.email === email('centre'))!
    expect(fake.effective(contact(), 'topic_alerts')).toBe('opt_in')
    await updatePreferences(manage, { weeklyDigest: false, specialAlerts: false })
    await syncPendingSubscribers(provider, { deadline: Date.now() + 10_000 })
    expect(contact().unsubscribed).toBe(true)
    expect(fake.effective(contact(), 'topic_weekly')).toBe('opt_out')
  })

  it('Resend cannot re-subscribe someone; only a confirmed double opt-in does, and Resend then follows', async () => {
    await confirmedReader('resub', false)
    await webhook(signed(fake.oneClickUnsubscribe(email('resub'))))
    // Someone flips the contact back in Resend: we refuse and push our state back.
    const contact = [...fake.contactsById.values()].find((c) => c.email === email('resub'))!
    contact.unsubscribed = false
    await webhook(signed(fake.contactEvent('contact.updated', contact)))
    expect((await prisma.subscriber.findFirst({ where: { email: email('resub') } }))?.status).toBe('UNSUBSCRIBED')
    await syncPendingSubscribers(provider, { deadline: Date.now() + 10_000 })
    expect(contact.unsubscribed).toBe(true)
    // A real re-subscription: a new confirmation (the address previously unsubscribed, so its links are aged first).
    await prisma.subscriberToken.updateMany({ where: { subscriber: { email: email('resub') } }, data: { createdAt: new Date(Date.now() - 2 * DAY) } })
    const again = await requestSubscription({ email: email('resub'), alerts: false })
    await confirmSubscription(/token=([A-Za-z0-9_-]{43})/.exec(again.mail!.html)![1])
    await syncPendingSubscribers(provider, { deadline: Date.now() + 10_000 })
    expect(contact.unsubscribed).toBe(false)
    expect(fake.effective(contact, 'topic_weekly')).toBe('opt_in')
  })
})
