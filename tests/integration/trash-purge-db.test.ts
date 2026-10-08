/**
 * Trash retention purge against a REAL Postgres: what the mocked unit tests cannot show.
 *
 * Incident 2026-10-07: the scheduler's hidden purge hard-deleted two trashed articles.
 * This proves, on real rows and real foreign keys, that purgeExpiredTrash():
 *   - removes only rows trashed at or before now - retention, and nothing else;
 *   - leaves rows inside the retention window, and live (never trashed) rows, alone;
 *   - writes exactly one audit_logs row per removed article, with the scheduler actor;
 *   - is idempotent (a second run changes nothing);
 *   - dry-run changes nothing;
 *   - cascades children but only NULLs notification links (no notification is deleted).
 *
 * DESTRUCTIVE by design: the function deletes every expired trashed article in the
 * database it runs against. So this suite refuses to run anywhere except a database whose
 * name contains "purge_test", on a host the central guard accepts (never .env.local):
 *
 *   createdb -h localhost -p 5433 -U postgres -T consilium_template consilium_purge_test
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5433/consilium_purge_test \
 *     npx vitest run tests/integration/trash-purge-db.test.ts
 *   dropdb -h localhost -p 5433 -U postgres consilium_purge_test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
const DB_NAME = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, '') : ''

async function ready(): Promise<boolean> {
  if (!TEST_DB || !DB_NAME.includes('purge_test')) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(`select 1 from information_schema.tables where table_name = 'audit_logs'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const isReady = await ready()
if (!isReady) console.warn('[trash-purge-db] skipped: needs TEST_DATABASE_URL pointing at a *purge_test* database')
const suite = isReady ? describe : describe.skip

const NOW = new Date('2026-10-07T00:08:52.000Z')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

let db: PrismaClient
let purgeExpiredTrash: typeof import('@/lib/trashPurge').purgeExpiredTrash

const tag = `purge${Date.now().toString(36)}`
const ids = {
  expired: `${tag}-expired`,
  boundary: `${tag}-boundary`,
  inside: `${tag}-inside`,
  live: `${tag}-live`,
  publishedLive: `${tag}-published`,
  withChildren: `${tag}-children`,
}
let authorId = ''
let readerId = ''

suite('trash purge (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) }) as unknown as PrismaClient
    // Point the application code at the guarded test client, same as the other DB suites.
    const { vi } = await import('vitest')
    vi.doMock('@/lib/prisma', () => ({ prisma: db }))
    ;({ purgeExpiredTrash } = await import('@/lib/trashPurge'))

    const author = await db.user.create({ data: { email: `${tag}-author@example.test`, name: 'Purge Author', role: 'WRITER' } })
    const reader = await db.user.create({ data: { email: `${tag}-reader@example.test`, name: 'Purge Reader', role: 'READER' } })
    authorId = author.id
    readerId = reader.id

    const base = { authorId, content: 'body', status: 'DRAFT' as const }
    await db.article.create({ data: { ...base, id: ids.expired, title: 'Expired', slug: ids.expired, deletedAt: daysAgo(40) } })
    // Exactly at the cutoff: eligible (the rule is "at or before").
    await db.article.create({ data: { ...base, id: ids.boundary, title: 'Boundary', slug: ids.boundary, deletedAt: daysAgo(30) } })
    await db.article.create({ data: { ...base, id: ids.inside, title: 'Inside window', slug: ids.inside, deletedAt: daysAgo(29) } })
    await db.article.create({ data: { ...base, id: ids.live, title: 'Live draft', slug: ids.live } })
    await db.article.create({
      data: { ...base, id: ids.publishedLive, title: 'Published', slug: ids.publishedLive, status: 'PUBLISHED', publishedAt: daysAgo(90) },
    })
    await db.article.create({ data: { ...base, id: ids.withChildren, title: 'Has children', slug: ids.withChildren, deletedAt: daysAgo(35) } })
    await db.bookmark.create({ data: { userId: readerId, articleId: ids.withChildren } })
    await db.comment.create({ data: { articleId: ids.withChildren, userId: readerId, body: 'hello' } })
    await db.notification.create({
      data: { userId: authorId, type: 'published', title: 't', message: 'm', articleId: ids.withChildren },
    })
  })

  afterAll(async () => {
    const all = Object.values(ids)
    await db.auditLog.deleteMany({ where: { targetId: { in: all } } })
    await db.notification.deleteMany({ where: { userId: { in: [authorId, readerId] } } })
    await db.article.deleteMany({ where: { id: { in: all } } })
    await db.user.deleteMany({ where: { id: { in: [authorId, readerId] } } })
    await db.$disconnect()
  })

  const existing = async () =>
    (await db.article.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true } })).map((a) => a.id).sort()

  it('a dry run lists the eligible rows and deletes nothing', async () => {
    const before = await existing()
    const res = await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(res.count).toBe(0)
    const would = res.wouldPurge.map((a) => a.id)
    for (const id of [ids.expired, ids.boundary, ids.withChildren]) expect(would).toContain(id)
    for (const id of [ids.inside, ids.live, ids.publishedLive]) expect(would).not.toContain(id)
    expect(await existing()).toEqual(before)
    expect(await db.auditLog.count({ where: { targetId: { in: Object.values(ids) } } })).toBe(0)
  })

  it('removes only rows trashed at or before the cutoff, and reports exactly those', async () => {
    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.errors).toEqual([])
    const mine = res.articleIds.filter((id) => id.startsWith(tag)).sort()
    expect(mine).toEqual([ids.boundary, ids.expired, ids.withChildren].sort())

    // survivors: inside the window, never trashed, and a long-published live article
    expect(await existing()).toEqual([ids.inside, ids.live, ids.publishedLive].sort())
  })

  it('wrote one scheduler-attributed audit row per removed article, and none for survivors', async () => {
    const rows = await db.auditLog.findMany({ where: { targetId: { in: Object.values(ids) } }, orderBy: { targetId: 'asc' } })
    expect(rows.map((r) => r.targetId).sort()).toEqual([ids.boundary, ids.expired, ids.withChildren].sort())
    for (const r of rows) {
      expect(r.action).toBe('ARTICLE_HARD_DELETED')
      expect(r.targetType).toBe('article')
      expect(r.performedBy).toBe('system:trash-purge')
    }
    const expired = rows.find((r) => r.targetId === ids.expired)!
    expect(expired.metadata).toMatchObject({
      source: 'trash-retention-purge',
      title: 'Expired',
      slug: ids.expired,
      authorId,
      deletedAt: daysAgo(40).toISOString(),
      purgedAt: NOW.toISOString(),
      retentionDays: 30,
    })
  })

  it('cascaded the purged article\'s bookmark and comment, but only unlinked (never deleted) its notification', async () => {
    expect(await db.bookmark.count({ where: { articleId: ids.withChildren } })).toBe(0)
    expect(await db.comment.count({ where: { articleId: ids.withChildren } })).toBe(0)
    const notes = await db.notification.findMany({ where: { userId: authorId } })
    expect(notes).toHaveLength(1)
    expect(notes[0].articleId).toBeNull()
  })

  it('is idempotent: a second run removes nothing and writes no further audit rows', async () => {
    const auditBefore = await db.auditLog.count({ where: { targetId: { in: Object.values(ids) } } })
    const second = await purgeExpiredTrash({ now: NOW })
    expect(second.articleIds.filter((id) => id.startsWith(tag))).toEqual([])
    expect(await db.auditLog.count({ where: { targetId: { in: Object.values(ids) } } })).toBe(auditBefore)
    expect(await existing()).toEqual([ids.inside, ids.live, ids.publishedLive].sort())
  })

  it('cannot be configured below 30 days: asking for 1-day retention still spares the 29-day-old row', async () => {
    const res = await purgeExpiredTrash({ now: NOW, retentionDays: 1 })
    expect(res.retentionDays).toBe(30)
    expect(res.articleIds).not.toContain(ids.inside)
    expect(await existing()).toEqual([ids.inside, ids.live, ids.publishedLive].sort())
  })

  it('the row inside the window is purged only once it ages past retention', async () => {
    const later = new Date(NOW.getTime() + 2 * DAY) // now 31 days after the "inside" row was trashed 29 days ago
    const res = await purgeExpiredTrash({ now: later })
    expect(res.articleIds).toContain(ids.inside)
    expect(await existing()).toEqual([ids.live, ids.publishedLive].sort())
  })
})
