/**
 * Weekly editions and alerts end to end against a real (local, disposable) database, with the in-memory
 * marketing provider standing in for Resend. Every scenario runs in its own future week (2031+) so the seeded
 * articles never fall into an edition window. Nothing leaves the process.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const session: { role: Role } = { role: 'ADMIN' }
vi.mock('@/lib/auth', () => ({
  requireVerifiedSessionUser: vi.fn(async (roles: readonly Role[]) =>
    roles.includes(session.role)
      ? { ok: true, user: { id: `test-${session.role.toLowerCase()}`, role: session.role, name: `Test ${session.role}`, email: null } }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
  ),
}))

import { PATCH as campaignPatch, GET as campaignGet } from '@/app/api/editorial/newsletter/campaigns/[id]/route'
import { POST as campaignsPost } from '@/app/api/editorial/newsletter/campaigns/route'
import { PUT as settingsPut } from '@/app/api/editorial/newsletter/settings/route'
import {
  approveCampaign,
  broadcastName,
  cancelCampaign,
  createAlertCampaign,
  ensureWeeklyEdition,
  rebuildCampaign,
  runDueCampaigns,
  updateCampaignContent,
} from '@/lib/newsletter/campaigns'
import { readContent, verifySnapshotStillPublic } from '@/lib/newsletter/edition'
import { ProviderError, createMemoryProvider, setMarketingProviderForTests, type MemoryProvider } from '@/lib/newsletter/provider'
import { currentWeeklySlot } from '@/lib/newsletter/schedule'
import { AUTO_SEND_SETTING_KEY, PAUSE_SETTING_KEY } from '@/lib/newsletter/settings'
import { runNewsletterTick } from '@/lib/newsletter/tick'
import { POST as cronRoute } from '@/app/api/cron/newsletter/route'

assertSafeTestDatabaseHost(process.env.TEST_DATABASE_URL!, 'TEST_DATABASE_URL')

const RUN = randomUUID().slice(0, 8)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ADMIN = { id: 'test-admin', name: 'Test Admin' }
const BASE = new Date('2031-01-10T12:00:00Z')
const week = (n: number) => currentWeeklySlot(new Date(BASE.getTime() + n * 7 * DAY))

let authorId = ''
const articleIds: string[] = []

async function article(title: string, data: { publishedAt?: Date | null; status?: 'PUBLISHED' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED'; deletedAt?: Date | null; slug?: string; excerpt?: string | null; scheduledAt?: Date | null }) {
  const created = await prisma.article.create({
    data: {
      title: `NL-${RUN} ${title}`,
      slug: data.slug ?? `nl-${RUN}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${articleIds.length}`,
      content: '<p>Body</p>',
      excerpt: data.excerpt === undefined ? `Summary of ${title}` : data.excerpt,
      authorId,
      status: data.status ?? 'PUBLISHED',
      publishedAt: data.publishedAt ?? null,
      scheduledAt: data.scheduledAt ?? null,
      deletedAt: data.deletedAt ?? null,
    },
  })
  articleIds.push(created.id)
  return created
}

const email = (label: string) => `${label}-${RUN}@newsletter.test`

async function subscriber(label: string, data: { status: 'ACTIVE' | 'PENDING' | 'LEGACY' | 'UNSUBSCRIBED' | 'SUPPRESSED'; weeklyDigest?: boolean; specialAlerts?: boolean; confirmed?: boolean }) {
  return prisma.subscriber.create({
    data: {
      email: email(label),
      status: data.status,
      weeklyDigest: data.weeklyDigest ?? true,
      specialAlerts: data.specialAlerts ?? false,
      confirmedAt: data.confirmed === false ? null : new Date('2030-01-01T00:00:00Z'),
      resendSyncState: 'PENDING',
    },
  })
}

/** A fresh Resend stand-in; every subscriber must be pushed to it again. */
async function freshProvider(): Promise<MemoryProvider> {
  const provider = createMemoryProvider()
  setMarketingProviderForTests(provider)
  await prisma.subscriber.updateMany({ where: { email: { endsWith: '@newsletter.test' } }, data: { resendSyncState: 'PENDING', resendContactId: null, resendSyncError: null } })
  return provider
}

async function cleanCampaigns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE newsletter_campaigns DISABLE TRIGGER newsletter_campaigns_protect`)
  await prisma.newsletterCampaign.deleteMany({})
  await prisma.$executeRawUnsafe(`ALTER TABLE newsletter_campaigns ENABLE TRIGGER newsletter_campaigns_protect`)
}

beforeAll(async () => {
  const writer = await prisma.user.findFirstOrThrow({ where: { role: { in: ['WRITER', 'ADMIN'] } }, select: { id: true } })
  authorId = writer.id
  await cleanCampaigns()
  await prisma.subscriber.deleteMany({ where: { email: { endsWith: '@newsletter.test' } } })
  await prisma.siteSetting.upsert({ where: { key: PAUSE_SETTING_KEY }, create: { key: PAUSE_SETTING_KEY, value: 'false' }, update: { value: 'false' } })
  await subscriber('weekly', { status: 'ACTIVE' })
  await subscriber('both', { status: 'ACTIVE', specialAlerts: true })
  await subscriber('pending', { status: 'PENDING', confirmed: false })
  await subscriber('legacy', { status: 'LEGACY', confirmed: false })
  await subscriber('unsubscribed', { status: 'UNSUBSCRIBED' })
  await subscriber('suppressed', { status: 'SUPPRESSED' })
})

afterAll(async () => {
  await cleanCampaigns()
  await prisma.auditLog.deleteMany({ where: { targetType: { in: ['newsletter_campaign', 'site_setting'] } } })
  await prisma.subscriber.deleteMany({ where: { email: { endsWith: '@newsletter.test' } } })
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } })
  await prisma.siteSetting.deleteMany({ where: { key: { in: [PAUSE_SETTING_KEY, AUTO_SEND_SETTING_KEY] } } })
  setMarketingProviderForTests(null)
})

describe('weekly edition: content and one-per-edition', () => {
  it('builds at cut-off from genuinely published, public articles only', async () => {
    const slot = week(0)
    const included1 = await article('Included early', { publishedAt: new Date(slot.cutoff.getTime() - 2 * DAY) })
    const included2 = await article('Included late', { publishedAt: new Date(slot.cutoff.getTime() - 3 * HOUR) })
    await article('Draft', { status: 'DRAFT', publishedAt: new Date(slot.cutoff.getTime() - DAY) })
    await article('Scheduled', { status: 'SCHEDULED', scheduledAt: new Date(slot.cutoff.getTime() - DAY) })
    await article('Trashed', { publishedAt: new Date(slot.cutoff.getTime() - DAY), deletedAt: new Date(slot.cutoff.getTime() - HOUR) })
    await article('Withdrawn', { status: 'ARCHIVED', publishedAt: new Date(slot.cutoff.getTime() - DAY) })
    await article('Last week', { publishedAt: new Date(slot.cutoff.getTime() - 8 * DAY) })
    await article('After cut-off', { publishedAt: new Date(slot.cutoff.getTime() + 10 * MIN) })
    const broken = await article('Broken link', { publishedAt: new Date(slot.cutoff.getTime() - DAY), slug: `nl-${RUN}-bad/slug` })

    expect((await ensureWeeklyEdition(new Date(slot.cutoff.getTime() - MIN))).state).toBe('not_due')
    const built = await ensureWeeklyEdition(new Date(slot.cutoff.getTime() + 20 * MIN))
    expect(built.state).toBe('created')
    if (built.state === 'not_due') throw new Error('unreachable')
    expect(built.campaign.status).toBe('DRAFT')
    const content = readContent(built.campaign.articles)
    expect(content.items.map((i) => i.id)).toEqual([included1.id, included2.id])
    expect(content.items[0]).toMatchObject({ title: included1.title, summary: `Summary of Included early`, url: expect.stringMatching(/\/articles\/nl-/) })
    expect(content.excluded).toEqual([expect.objectContaining({ id: broken.id, reason: expect.stringMatching(/canonical public link/) })])
  })

  it('is idempotent, including when the scheduler runs concurrently', async () => {
    const slot = week(0)
    const results = await Promise.all(Array.from({ length: 6 }, () => ensureWeeklyEdition(new Date(slot.cutoff.getTime() + 30 * MIN))))
    expect(results.every((r) => r.state === 'exists')).toBe(true)
    expect(await prisma.newsletterCampaign.count({ where: { editionKey: slot.editionKey } })).toBe(1)
  })

  it('gives the same edition whatever the server time zone', async () => {
    const original = process.env.TZ
    try {
      process.env.TZ = 'America/Los_Angeles'
      const result = await ensureWeeklyEdition(new Date(week(0).cutoff.getTime() + 40 * MIN))
      expect(result.editionKey).toBe(week(0).editionKey)
      expect(result.state).toBe('exists')
    } finally {
      process.env.TZ = original
    }
  })
})

describe('approval, pause and exactly-once sending', () => {
  it('approval is bound to the previewed content and only admins may approve', async () => {
    const campaign = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { editionKey: week(0).editionKey } })
    await expect(approveCampaign(campaign.id, ADMIN, { expectedHash: 'stale' })).rejects.toMatchObject({ code: 'STALE_PREVIEW' })

    for (const role of ['EDITOR', 'GROWTH', 'WRITER'] as Role[]) {
      session.role = role
      const res = await campaignPatch(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ action: 'approve', expectedHash: campaign.contentHash }) }), { params: Promise.resolve({ id: campaign.id }) })
      expect(res.status, role).toBe(403)
    }
    session.role = 'GROWTH'
    expect((await campaignGet(new Request('http://localhost'), { params: Promise.resolve({ id: campaign.id }) })).status).toBe(200)
    expect((await campaignsPost(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'build_weekly' }) }))).status).toBe(403)

    session.role = 'ADMIN'
    const res = await campaignPatch(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ action: 'approve', expectedHash: campaign.contentHash }) }), { params: Promise.resolve({ id: campaign.id }) })
    expect(res.status).toBe(200)
    const approved = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: campaign.id } })
    expect(approved).toMatchObject({ status: 'SCHEDULED', approvedHash: campaign.contentHash, approvedById: 'test-admin' })
    expect(approved.scheduledFor?.toISOString()).toBe(week(0).sendAt.toISOString())
  })

  it('pausing stops everything; editors may pause but only admins may resume', async () => {
    const provider = await freshProvider()
    session.role = 'EDITOR'
    expect((await settingsPut(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ paused: true }) }))).status).toBe(200)
    expect((await settingsPut(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ paused: false }) }))).status).toBe(403)
    const report = await runDueCampaigns(new Date(week(0).sendAt.getTime() + MIN))
    expect(report.paused).toBe(true)
    expect(provider.state.calls).toEqual([])
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { editionKey: week(0).editionKey } })).status).toBe('SCHEDULED')
    session.role = 'ADMIN'
    expect((await settingsPut(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ paused: false }) }))).status).toBe(200)
  })

  it('concurrent runs send once, to confirmed weekly subscribers only, after switching off strays', async () => {
    const provider = await freshProvider()
    // A contact that exists in Resend but is not an active subscriber here (e.g. an erased account).
    await provider.syncContact({ email: email('erased'), subscribed: true, topics: { weekly: true, alerts: true } })
    const at = new Date(week(0).sendAt.getTime() + MIN)
    const reports = await Promise.all([runDueCampaigns(at), runDueCampaigns(at), runDueCampaigns(at)])
    const outcomes = reports.flatMap((r) => r.results.map((x) => x.outcome))
    expect(outcomes).toEqual(['sent'])
    expect(provider.state.calls.filter((c) => c === 'createBroadcast')).toHaveLength(1)
    expect(provider.state.calls.filter((c) => c === 'sendBroadcast')).toHaveLength(1)
    const [broadcast] = [...provider.state.broadcasts.values()]
    expect(broadcast.recipients).toEqual([email('both'), email('weekly')].sort())
    expect(broadcast.html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
    const sent = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { editionKey: week(0).editionKey } })
    expect(sent).toMatchObject({ status: 'SENT', resendBroadcastId: broadcast.id, recipientCount: 2 })

    // Later runs do nothing; the sent record is immutable.
    expect((await runDueCampaigns(new Date(at.getTime() + DAY))).results).toEqual([])
    await expect(rebuildCampaign(sent.id, ADMIN)).rejects.toMatchObject({ code: 'NOT_REBUILDABLE' })
    await expect(cancelCampaign(sent.id, ADMIN, null)).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' })
    await expect(prisma.newsletterCampaign.update({ where: { id: sent.id }, data: { subject: 'changed' } })).rejects.toThrow(/immutable/)
    await expect(prisma.newsletterCampaign.delete({ where: { id: sent.id } })).rejects.toThrow(/cannot be deleted/)
    await prisma.newsletterCampaign.update({ where: { id: sent.id }, data: { deliveredCount: { increment: 1 } } })
  })

  it('the database refuses a second send record for the same edition and approval of changed content', async () => {
    const sent = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { editionKey: week(0).editionKey } })
    await expect(prisma.newsletterCampaign.create({ data: { kind: 'WEEKLY', editionKey: sent.editionKey, subject: 'x', articles: {}, contentHash: 'h' } })).rejects.toThrow()
    await expect(
      prisma.newsletterCampaign.create({ data: { kind: 'WEEKLY', editionKey: 'weekly:2040-01-06', subject: 'x', articles: {}, contentHash: 'new', approvedHash: 'old', approvedAt: new Date(), scheduledFor: new Date(), status: 'SCHEDULED' } }),
    ).rejects.toThrow(/newsletter_campaigns_approved_content/)
  })
})

describe('fail-closed publication check', () => {
  it('detects every way an approved article can stop being public or change', async () => {
    const slot = week(1)
    const at = new Date(slot.sendAt.getTime() + MIN)
    const cases = {
      unpublished: await article('Becomes draft', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      trashed: await article('Gets trashed', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      rescheduled: await article('Gets rescheduled', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      withdrawn: await article('Gets archived', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      slug: await article('Slug changes', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      title: await article('Title changes', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      excerpt: await article('Excerpt changes', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      recent: await article('Republished just now', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
      fine: await article('Untouched', { publishedAt: new Date(slot.cutoff.getTime() - DAY) }),
    }
    const built = await ensureWeeklyEdition(new Date(slot.cutoff.getTime() + MIN))
    if (built.state === 'not_due') throw new Error('unreachable')
    const items = readContent(built.campaign.articles).items
    expect(await verifySnapshotStillPublic(items, at)).toEqual([])

    await prisma.article.update({ where: { id: cases.unpublished.id }, data: { status: 'DRAFT' } })
    await prisma.article.update({ where: { id: cases.trashed.id }, data: { deletedAt: new Date() } })
    await prisma.article.update({ where: { id: cases.rescheduled.id }, data: { status: 'SCHEDULED', scheduledAt: new Date(at.getTime() + DAY) } })
    await prisma.article.update({ where: { id: cases.withdrawn.id }, data: { status: 'ARCHIVED' } })
    await prisma.article.update({ where: { id: cases.slug.id }, data: { slug: `${cases.slug.slug}-moved` } })
    await prisma.article.update({ where: { id: cases.title.id }, data: { title: `${cases.title.title} (edited)` } })
    await prisma.article.update({ where: { id: cases.excerpt.id }, data: { excerpt: 'A different summary' } })
    await prisma.article.update({ where: { id: cases.recent.id }, data: { publishedAt: new Date(at.getTime() - 10 * MIN) } })
    const problems = await verifySnapshotStillPublic(items, at)
    const byId = new Map(problems.map((p) => [p.id, p.problem]))
    expect(byId.get(cases.unpublished.id)).toMatch(/no longer publicly published/)
    expect(byId.get(cases.trashed.id)).toMatch(/no longer publicly published/)
    expect(byId.get(cases.rescheduled.id)).toMatch(/no longer publicly published/)
    expect(byId.get(cases.withdrawn.id)).toMatch(/no longer publicly published/)
    expect(byId.get(cases.slug.id)).toMatch(/link changed/)
    expect(byId.get(cases.title.id)).toMatch(/title changed/)
    expect(byId.get(cases.excerpt.id)).toMatch(/summary changed/)
    expect(byId.get(cases.recent.id)).toMatch(/safe delay/)
    expect(byId.has(cases.fine.id)).toBe(false)

    // Approved before the changes: the send is blocked, nothing reaches Resend.
    const provider = await freshProvider()
    await prisma.$executeRawUnsafe(`UPDATE newsletter_campaigns SET status = 'SCHEDULED', "approvedAt" = now(), "approvedHash" = "contentHash", "scheduledFor" = $1 WHERE id = $2`, slot.sendAt, built.campaign.id)
    const report = await runDueCampaigns(at)
    expect(report.results.map((r) => r.outcome)).toEqual(['blocked'])
    expect(provider.state.calls.filter((c) => c.endsWith('Broadcast'))).toEqual([])
    const blocked = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: built.campaign.id } })
    expect(blocked.status).toBe('BLOCKED')
    expect(blocked.blockedReason).toMatch(/Becomes draft/)

    // A rebuild takes only what is still public, and needs a fresh approval.
    const rebuilt = await rebuildCampaign(blocked.id, ADMIN, new Date(slot.sendAt.getTime() + 2 * MIN))
    expect(rebuilt.status).toBe('DRAFT')
    expect(rebuilt.approvedHash).toBeNull()
    expect(readContent(rebuilt.articles).items.map((i) => i.id)).toEqual(expect.arrayContaining([cases.fine.id, cases.title.id, cases.excerpt.id]))
    expect(readContent(rebuilt.articles).items.map((i) => i.id)).not.toContain(cases.trashed.id)
  })

  it('optionally fetches each public link and blocks on anything but 200', async () => {
    const slot = week(1)
    const items = readContent((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { editionKey: slot.editionKey } })).articles).items
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response('', { status: String(url).includes(items[0].slug) ? 404 : 200 })) as unknown as typeof fetch
    const problems = await verifySnapshotStillPublic(items, new Date(slot.sendAt.getTime() + 3 * MIN), { fetchLinks: true, fetchImpl })
    expect(problems).toEqual([expect.objectContaining({ id: items[0].id, problem: 'public link answered HTTP 404' })])
  })

  it('articles from a blocked edition roll into the next one; an empty week is skipped; a badly late edition is skipped rather than sent', async () => {
    const next = await ensureWeeklyEdition(new Date(week(2).cutoff.getTime() + MIN))
    expect(next.state === 'created' && readContent(next.campaign.articles).items.map((i) => i.title)).toEqual(expect.arrayContaining([expect.stringMatching(/Untouched/)]))
    // Nothing published within the 14-day look-back of week 30.
    const empty = await ensureWeeklyEdition(new Date(week(30).cutoff.getTime() + MIN))
    expect(empty.state === 'created' && empty.campaign.status).toBe('SKIPPED')
    await article('Late week article', { publishedAt: new Date(week(3).cutoff.getTime() - DAY) })
    const late = await ensureWeeklyEdition(new Date(week(3).sendAt.getTime() + 25 * HOUR))
    expect(late.state === 'created' && late.campaign.status).toBe('SKIPPED')
    expect(late.state === 'created' && late.campaign.blockedReason).toMatch(/Missed the send window/)
  })
})

async function scheduledEdition(n: number) {
  const slot = week(n)
  await article(`Week ${n} piece`, { publishedAt: new Date(slot.cutoff.getTime() - DAY) })
  const built = await ensureWeeklyEdition(new Date(slot.cutoff.getTime() + MIN))
  if (built.state === 'not_due') throw new Error('unreachable')
  const approved = await approveCampaign(built.campaign.id, ADMIN, { expectedHash: built.campaign.contentHash }, new Date(slot.cutoff.getTime() + 2 * MIN))
  return { slot, campaign: approved, at: new Date(slot.sendAt.getTime() + MIN) }
}

describe('send failures, retries and reconciliation', () => {
  it('a failure before anything is sent backs off and retries, creating exactly one broadcast', async () => {
    const { campaign, at } = await scheduledEdition(4)
    const provider = await freshProvider()
    let failures = 1
    provider.failWith((op) => (op === 'createBroadcast' && failures-- > 0 ? new ProviderError('rate_limit_exceeded', true, 429) : undefined))
    expect((await runDueCampaigns(at)).results.map((r) => r.outcome)).toEqual(['retry_later'])
    const failed = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: campaign.id } })
    expect(failed).toMatchObject({ status: 'FAILED', sendAttempts: 1, lastError: expect.stringMatching(/create: rate_limit_exceeded/) })
    expect(failed.nextAttemptAt!.getTime() - at.getTime()).toBe(10 * MIN)
    expect((await runDueCampaigns(new Date(at.getTime() + 5 * MIN))).results).toEqual([])
    expect((await runDueCampaigns(new Date(at.getTime() + 11 * MIN))).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(provider.state.broadcasts.size).toBe(1)
  })

  it('an unknown outcome is resolved from Resend’s own state, never by sending again', async () => {
    const { campaign, at } = await scheduledEdition(5)
    const provider = await freshProvider()
    provider.failWith((op, id) => {
      if (op !== 'sendBroadcast') return
      // Resend accepted the send, but the response never arrived.
      provider.state.broadcasts.get(id as string)!.status = 'sent'
      return new ProviderError('network: socket hang up', true, undefined, true)
    })
    expect((await runDueCampaigns(at)).results.map((r) => r.outcome)).toEqual(['uncertain'])
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENDING')
    provider.failWith(null)
    expect((await runDueCampaigns(new Date(at.getTime() + 5 * MIN))).results).toEqual([]) // lease still held
    expect((await runDueCampaigns(new Date(at.getTime() + 11 * MIN))).results.map((r) => r.outcome)).toEqual(['already_sent'])
    expect(provider.state.calls.filter((c) => c === 'sendBroadcast')).toHaveLength(1)
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT')
  })

  it('a crash after creating the broadcast is recovered by name, without creating another', async () => {
    const { campaign, at } = await scheduledEdition(6)
    const provider = await freshProvider()
    const orphan = await provider.createBroadcast({ name: broadcastName(campaign), subject: campaign.subject, html: 'h', text: 't', topic: 'weekly' })
    await prisma.newsletterCampaign.update({ where: { id: campaign.id }, data: { status: 'SENDING', sendAttempts: 1, leaseUntil: new Date(at.getTime() - MIN) } })
    provider.state.calls.length = 0
    expect((await runDueCampaigns(at)).results.map((r) => r.outcome)).toEqual(['sent'])
    expect(provider.state.calls).not.toContain('createBroadcast')
    expect((await prisma.newsletterCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).resendBroadcastId).toBe(orphan.id)
  })

  it('holds the send while a withdrawal cannot be pushed to Resend', async () => {
    const { campaign, at } = await scheduledEdition(7)
    const provider = await freshProvider()
    const leaving = await subscriber('leaving', { status: 'UNSUBSCRIBED' })
    provider.failWith((op, detail) => ((op === 'syncContact' && (detail as { email: string }).email === leaving.email) ? new ProviderError('service unavailable', true, 503) : undefined))
    const report = await runDueCampaigns(at)
    expect(report.results).toEqual([expect.objectContaining({ outcome: 'retry_later', detail: expect.stringMatching(/not yet synced/) })])
    expect(provider.state.calls).not.toContain('createBroadcast')
    provider.failWith(null)
    expect((await runDueCampaigns(new Date(at.getTime() + 11 * MIN))).results.map((r) => r.outcome)).toEqual(['sent'])
    expect([...provider.state.broadcasts.values()][0].recipients).not.toContain(leaving.email)
    expect(campaign.id).toBeTruthy()
  })

  it('a stale draft from an earlier week can no longer be approved', async () => {
    const slot = week(9)
    await article('Week 9 piece', { publishedAt: new Date(slot.cutoff.getTime() - DAY) })
    const built = await ensureWeeklyEdition(new Date(slot.cutoff.getTime() + MIN))
    if (built.state === 'not_due') throw new Error('unreachable')
    await expect(approveCampaign(built.campaign.id, ADMIN, { expectedHash: built.campaign.contentHash }, new Date(slot.sendAt.getTime() + 2 * DAY))).rejects.toMatchObject({ code: 'TOO_LATE' })
  })

  it('editing an approved edition returns it to draft; cancelling stops it', async () => {
    const slot = week(8)
    await article('Week 8 piece', { publishedAt: new Date(slot.cutoff.getTime() - DAY) })
    const built = await ensureWeeklyEdition(new Date(slot.cutoff.getTime() + MIN))
    if (built.state === 'not_due') throw new Error('unreachable')
    await approveCampaign(built.campaign.id, ADMIN, { expectedHash: built.campaign.contentHash }, new Date(slot.cutoff.getTime() + MIN))
    const edited = await updateCampaignContent(built.campaign.id, ADMIN, { intro: 'A note from the editors.' })
    expect(edited).toMatchObject({ status: 'DRAFT', approvedHash: null, intro: 'A note from the editors.' })
    const cancelled = await cancelCampaign(built.campaign.id, ADMIN, 'Not this week')
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Not this week' })
    expect((await runDueCampaigns(new Date(slot.sendAt.getTime() + MIN))).results).toEqual([])
    const audit = await prisma.auditLog.findMany({ where: { targetId: built.campaign.id }, orderBy: { createdAt: 'asc' } })
    expect(audit.map((a) => a.action)).toEqual(['newsletter.campaign.built', 'newsletter.campaign.approved', 'newsletter.campaign.edited', 'newsletter.campaign.cancelled'])
  })
})

describe('special-article alerts', () => {
  // A Tuesday well away from the Friday edition.
  const tuesday = new Date(week(10).sendAt.getTime() - 3 * DAY - 6 * HOUR)

  it('refuse unpublished, old and duplicate articles', async () => {
    const draft = await article('Alert draft', { status: 'DRAFT' })
    await expect(createAlertCampaign(draft.id, ADMIN, tuesday)).rejects.toMatchObject({ code: 'NOT_PUBLIC' })
    const old = await article('Alert old', { publishedAt: new Date(tuesday.getTime() - 4 * DAY) })
    await expect(createAlertCampaign(old.id, ADMIN, tuesday)).rejects.toMatchObject({ code: 'TOO_OLD' })
  })

  it('go only to subscribers who opted in, and are capped', async () => {
    const first = await article('Alert one', { publishedAt: new Date(tuesday.getTime() - 3 * HOUR) })
    const alert = await createAlertCampaign(first.id, ADMIN, tuesday)
    await expect(createAlertCampaign(first.id, ADMIN, tuesday)).rejects.toMatchObject({ code: 'DUPLICATE' })
    const approved = await approveCampaign(alert.id, ADMIN, { expectedHash: alert.contentHash }, tuesday)
    expect(approved.scheduledFor!.getTime()).toBe(tuesday.getTime() + 10 * MIN)
    const provider = await freshProvider()
    expect((await runDueCampaigns(new Date(tuesday.getTime() + 11 * MIN))).results.map((r) => r.outcome)).toEqual(['sent'])
    const [broadcast] = [...provider.state.broadcasts.values()]
    expect(broadcast.topic).toBe('alerts')
    expect(broadcast.recipients).toEqual([email('both')])

    // A second alert two days later breaks the one-a-week cap.
    const second = await article('Alert two', { publishedAt: new Date(tuesday.getTime() + 2 * DAY - HOUR) })
    const secondAlert = await createAlertCampaign(second.id, ADMIN, new Date(tuesday.getTime() + 2 * DAY))
    await expect(approveCampaign(secondAlert.id, ADMIN, { expectedHash: secondAlert.contentHash }, new Date(tuesday.getTime() + 2 * DAY))).rejects.toMatchObject({ code: 'CAPPED' })
  })

  it('never lands within 12 hours of the weekly edition', async () => {
    const friday = week(12).sendAt
    const piece = await article('Alert near Friday', { publishedAt: new Date(friday.getTime() - 6 * HOUR) })
    const alert = await createAlertCampaign(piece.id, ADMIN, new Date(friday.getTime() - 4 * HOUR))
    await expect(approveCampaign(alert.id, ADMIN, { expectedHash: alert.contentHash }, new Date(friday.getTime() - 4 * HOUR))).rejects.toMatchObject({ code: 'CAPPED', message: expect.stringMatching(/12 hours/) })
  })
})

describe('scheduler tick', () => {
  it('builds at cut-off; with auto-send on it approves and later sends; paused, it only builds', async () => {
    await freshProvider()
    await prisma.siteSetting.upsert({ where: { key: AUTO_SEND_SETTING_KEY }, create: { key: AUTO_SEND_SETTING_KEY, value: 'true' }, update: { value: 'true' } })
    try {
      const slot = week(20)
      await article('Tick piece', { publishedAt: new Date(slot.cutoff.getTime() - DAY) })
      expect((await runNewsletterTick(new Date(slot.cutoff.getTime() - 5 * MIN))).weekly.state).toBe('not_due')
      const built = await runNewsletterTick(new Date(slot.cutoff.getTime() + 5 * MIN))
      expect(built.weekly).toMatchObject({ editionKey: slot.editionKey, state: 'created', status: 'SCHEDULED', autoApproved: true })
      expect(built.sends.results).toEqual([])
      const sent = await runNewsletterTick(new Date(slot.sendAt.getTime() + MIN))
      expect(sent.sends.results.map((r) => r.outcome)).toEqual(['sent'])

      await prisma.siteSetting.update({ where: { key: PAUSE_SETTING_KEY }, data: { value: 'true' } })
      const pausedSlot = week(21)
      await article('Paused piece', { publishedAt: new Date(pausedSlot.cutoff.getTime() - DAY) })
      const paused = await runNewsletterTick(new Date(pausedSlot.cutoff.getTime() + 5 * MIN))
      expect(paused).toMatchObject({ paused: true, weekly: { state: 'created', status: 'DRAFT' } })
      expect(paused.weekly.autoApproved).toBeUndefined()
    } finally {
      await prisma.siteSetting.update({ where: { key: PAUSE_SETTING_KEY }, data: { value: 'false' } })
      await prisma.siteSetting.update({ where: { key: AUTO_SEND_SETTING_KEY }, data: { value: 'false' } })
    }
  })

  it('applies retention: unconfirmed sign-ups after 30 days, expired tokens after 7', async () => {
    const stale = await prisma.subscriber.create({ data: { email: email('stale-pending'), status: 'PENDING', resendSyncState: 'SYNCED', subscribedAt: new Date(Date.now() - 31 * DAY) } })
    const fresh = await prisma.subscriber.create({ data: { email: email('fresh-pending'), status: 'PENDING', resendSyncState: 'SYNCED' } })
    await prisma.subscriberToken.create({ data: { subscriberId: fresh.id, purpose: 'CONFIRM', tokenHash: `old-${RUN}`, expiresAt: new Date(Date.now() - 8 * DAY) } })
    const summary = await runNewsletterTick(new Date())
    expect(summary.retention).toMatchObject({ unconfirmedSignupsDeleted: expect.any(Number), expiredTokensDeleted: expect.any(Number) })
    expect(await prisma.subscriber.findUnique({ where: { id: stale.id } })).toBeNull()
    expect(await prisma.subscriber.findUnique({ where: { id: fresh.id } })).not.toBeNull()
    expect(await prisma.subscriberToken.count({ where: { tokenHash: `old-${RUN}` } })).toBe(0)
  })

  it('the cron route requires its secret and reports counts only', async () => {
    vi.stubEnv('CRON_SECRET', 'local-cron-secret-for-tests')
    try {
      expect((await cronRoute(new Request('http://localhost/api/cron/newsletter', { method: 'POST' }))).status).toBe(401)
      const res = await cronRoute(new Request('http://localhost/api/cron/newsletter', { method: 'POST', headers: { authorization: 'Bearer local-cron-secret-for-tests' } }))
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).not.toMatch(/@newsletter\.test/)
      expect(JSON.parse(text)).toHaveProperty('weekly.editionKey')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
