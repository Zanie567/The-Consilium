/**
 * Trash retention purge vs debates, against a REAL Postgres with the real foreign keys.
 *
 * Incident 2026-11-09: six trashed articles belonging to three debates (two soft-deleted, one with 8
 * votes) passed 30 days in the Trash. Every daily purge then failed with HTTP 500 because
 * debates_forArticleId_fkey / debates_againstArticleId_fkey (ON DELETE RESTRICT) refused each delete.
 * Nothing was lost, but a permanent red run hides real failures. Approved policy, proved here:
 *   - an article any debate references (live, unpublished or soft-deleted) is RETAINED, whichever side
 *     it argues, and reported under `retained` (not `errors`), deterministically and once;
 *   - the debate and every vote survive; unrelated expired articles are still purged and audited;
 *   - a dry run separates "would delete" from "retained";
 *   - after an administrator permanently deletes the debate, its articles keep their ORIGINAL trash
 *     date and are purged by the next ordinary run if that date is past retention;
 *   - if a debate starts referencing an article while the purge is deleting it, the foreign key still
 *     refuses the delete: the article survives and the failure is reported, never swallowed.
 *
 * DESTRUCTIVE by design, like trash-purge-db.test.ts: a purge removes every expired, unreferenced
 * trashed article in the database. So it only runs against a database whose name contains
 * "purge_test", on a host the central guard accepts (never .env.local):
 *
 *   createdb -h localhost -p 5433 -U postgres -T consilium consilium_purge_test
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5433/consilium_purge_test \
 *     npx vitest run tests/integration/trash-purge-debates-db.test.ts
 *   dropdb -h localhost -p 5433 -U postgres consilium_purge_test
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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
    const { rowCount } = await client.query(
      `select 1 from information_schema.columns where table_name = 'debates' and column_name = 'deletedAt'`,
    )
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const isReady = await ready()
if (!isReady) console.warn('[trash-purge-debates-db] skipped: needs TEST_DATABASE_URL pointing at a *purge_test* database')
const suite = isReady ? describe : describe.skip

const { state } = vi.hoisted(() => ({ state: { prisma: undefined as unknown } }))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.prisma as Record<string | symbol, unknown>)[key] }),
}))

import { purgeExpiredTrash, type TrashPurgeResult } from '@/lib/trashPurge'
import { transitionDebate } from '@/lib/debateLifecycle'

const NOW = new Date('2026-11-09T11:37:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

let db: PrismaClient
const tag = `pdeb${Date.now().toString(36)}`
const ids = {
  // Live (published, featured) debate: its FOR article was trashed by an editor 40 days ago.
  activeFor: `${tag}-active-for`,
  activeAgainst: `${tag}-active-against`,
  // Unpublished debate: only its AGAINST article is trashed (33 days).
  unpubFor: `${tag}-unpub-for`,
  unpubAgainst: `${tag}-unpub-against`,
  // Soft-deleted debate with 8 votes, both articles trashed 31 days ago (the shape of seed-debate-aireg).
  deletedFor: `${tag}-deleted-for`,
  deletedAgainst: `${tag}-deleted-against`,
  // Not part of any debate.
  unrelatedExpired: `${tag}-unrelated-expired`,
  unrelatedInside: `${tag}-unrelated-inside`,
  // For the concurrency test: expired and unreferenced when the purge lists it.
  raced: `${tag}-raced`,
}
const debateIds = { active: `${tag}-d-active`, unpublished: `${tag}-d-unpub`, deleted: `${tag}-d-deleted`, raced: `${tag}-d-raced` }
let authorId = ''
let adminId = ''

const mine = <T extends { id: string }>(rows: T[]) => rows.filter((r) => r.id.startsWith(tag))
const mineIds = (list: string[]) => list.filter((id) => id.startsWith(tag))
const existing = async () =>
  (await db.article.findMany({ where: { id: { startsWith: tag } }, select: { id: true } })).map((a) => a.id).sort()
const articleState = (id: string) => db.article.findUniqueOrThrow({ where: { id }, select: { deletedAt: true, updatedAt: true } })
const hardDeleteAudits = () =>
  db.auditLog.findMany({ where: { targetId: { startsWith: tag }, action: 'ARTICLE_HARD_DELETED' }, select: { targetId: true } })

suite('trash purge keeps debate articles (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) }) as unknown as PrismaClient
    state.prisma = db

    authorId = (await db.user.create({ data: { email: `${tag}-author@example.test`, name: 'Debate Author', role: 'WRITER' } })).id
    adminId = (await db.user.create({ data: { email: `${tag}-admin@example.test`, name: 'Debate Admin', role: 'ADMIN' } })).id

    const art = (id: string, over: { deletedAt?: Date; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' } = {}) =>
      db.article.create({
        data: {
          id, slug: id, title: id, content: 'body', authorId, isDebate: true,
          status: over.status ?? 'DRAFT', deletedAt: over.deletedAt ?? null,
          ...(over.status === 'PUBLISHED' ? { publishedAt: daysAgo(90) } : {}),
        },
      })
    // Each debate is created while its articles are live, then the articles are trashed, which is the
    // order an editor's actions produce.
    await art(ids.activeFor, { status: 'PUBLISHED' })
    await art(ids.activeAgainst, { status: 'PUBLISHED' })
    await art(ids.unpubFor, { status: 'ARCHIVED' })
    await art(ids.unpubAgainst, { status: 'ARCHIVED' })
    await art(ids.deletedFor, { status: 'ARCHIVED' })
    await art(ids.deletedAgainst, { status: 'ARCHIVED' })
    await db.debate.createMany({
      data: [
        { id: debateIds.active, title: `${tag} active`, forArticleId: ids.activeFor, againstArticleId: ids.activeAgainst, isActive: true },
        {
          id: debateIds.unpublished, title: `${tag} unpublished`, forArticleId: ids.unpubFor, againstArticleId: ids.unpubAgainst,
          isActive: false, unpublishedAt: daysAgo(34),
        },
        {
          id: debateIds.deleted, title: `${tag} deleted`, forArticleId: ids.deletedFor, againstArticleId: ids.deletedAgainst,
          isActive: false, unpublishedAt: daysAgo(27), deletedAt: daysAgo(27), deletedById: adminId,
        },
      ],
    })
    await db.debateVote.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        debateId: debateIds.deleted, anonymousId: `${tag}-voter-${i}`, side: i < 5 ? ('FOR' as const) : ('AGAINST' as const),
      })),
    })
    await db.article.update({ where: { id: ids.activeFor }, data: { deletedAt: daysAgo(40) } })
    await db.article.update({ where: { id: ids.unpubAgainst }, data: { deletedAt: daysAgo(33) } })
    await db.article.updateMany({ where: { id: { in: [ids.deletedFor, ids.deletedAgainst] } }, data: { deletedAt: daysAgo(31) } })

    await art(ids.unrelatedExpired, { deletedAt: daysAgo(45) })
    await art(ids.unrelatedInside, { deletedAt: daysAgo(29) })
  })

  afterAll(async () => {
    if (!db) return
    await db.debate.deleteMany({ where: { id: { startsWith: tag } } }) // votes cascade
    await db.auditLog.deleteMany({ where: { targetId: { startsWith: tag } } })
    await db.article.deleteMany({ where: { id: { startsWith: tag } } })
    await db.user.deleteMany({ where: { id: { in: [authorId, adminId] } } })
    await db.$disconnect()
  })

  const expectedRetained = [
    // Oldest trash date first, then by id.
    { id: ids.activeFor, deletedAt: daysAgo(40).toISOString(), reason: 'referenced-by-debate', debates: [{ debateId: debateIds.active, position: 'for' }] },
    { id: ids.unpubAgainst, deletedAt: daysAgo(33).toISOString(), reason: 'referenced-by-debate', debates: [{ debateId: debateIds.unpublished, position: 'against' }] },
    ...[ids.deletedAgainst, ids.deletedFor].sort().map((id) => ({
      id,
      deletedAt: daysAgo(31).toISOString(),
      reason: 'referenced-by-debate',
      debates: [{ debateId: debateIds.deleted, position: id === ids.deletedFor ? 'for' : 'against' }],
    })),
  ]
  const retainedOf = (res: TrashPurgeResult) => mine(res.retained)

  it('a dry run lists the unrelated article as purgeable and the debate articles as retained, and changes nothing', async () => {
    const before = await existing()
    const res = await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(mineIds(res.wouldPurge.map((a) => a.id))).toEqual([ids.unrelatedExpired])
    expect(retainedOf(res)).toEqual(expectedRetained)
    expect(res.retainedCount).toBeGreaterThanOrEqual(expectedRetained.length)
    expect(await existing()).toEqual(before)
    expect(await hardDeleteAudits()).toEqual([])
  })

  it('a real run purges the unrelated article, retains every debate article without an error, and keeps the debates and votes', async () => {
    const statesBefore = await Promise.all(expectedRetained.map((r) => articleState(r.id)))
    const res = await purgeExpiredTrash({ now: NOW })

    // No error at all: before this fix each debate article was a foreign-key failure (HTTP 500).
    expect(res.errors).toEqual([])
    expect(mineIds(res.articleIds)).toEqual([ids.unrelatedExpired])
    expect(retainedOf(res)).toEqual(expectedRetained)

    expect(await existing()).toEqual(
      [ids.activeFor, ids.activeAgainst, ids.unpubFor, ids.unpubAgainst, ids.deletedFor, ids.deletedAgainst, ids.unrelatedInside].sort(),
    )
    // Retained articles are untouched: same trash date, no write at all.
    expect(await Promise.all(expectedRetained.map((r) => articleState(r.id)))).toEqual(statesBefore)
    expect(await db.debate.count({ where: { id: { in: [debateIds.active, debateIds.unpublished, debateIds.deleted] } } })).toBe(3)
    expect(await db.debateVote.count({ where: { debateId: debateIds.deleted } })).toBe(8)
    // Exactly one audit row, for the one article actually removed.
    expect((await hardDeleteAudits()).map((a) => a.targetId)).toEqual([ids.unrelatedExpired])
  })

  it('reporting is deterministic and free of duplicates across runs', async () => {
    const first = await purgeExpiredTrash({ now: NOW })
    const second = await purgeExpiredTrash({ now: NOW })
    expect(retainedOf(first)).toEqual(expectedRetained)
    expect(retainedOf(second)).toEqual(retainedOf(first))
    const allIds = second.retained.map((a) => a.id)
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(mineIds(second.articleIds)).toEqual([])
    expect(second.errors).toEqual([])
  })

  it('after an administrator permanently deletes the debate, its articles keep their trash date and the next run purges them', async () => {
    const trashDates = await Promise.all([ids.deletedFor, ids.deletedAgainst].map((id) => articleState(id)))
    const removed = await transitionDebate({ id: adminId }, debateIds.deleted, 'purge', { confirmTitle: `${tag} deleted`, now: NOW })
    expect(removed.votesRemoved).toBe(8)
    // Already trashed, so the debate purge does not touch them: the retention clock is NOT restarted.
    expect(removed.articlesChanged).toBe(0)
    expect(await db.debateVote.count({ where: { debateId: debateIds.deleted } })).toBe(0)
    expect((await Promise.all([ids.deletedFor, ids.deletedAgainst].map((id) => articleState(id)))).map((s) => s.deletedAt))
      .toEqual(trashDates.map((s) => s.deletedAt))

    const dry = await purgeExpiredTrash({ now: NOW, dryRun: true })
    expect(mineIds(dry.wouldPurge.map((a) => a.id)).sort()).toEqual([ids.deletedAgainst, ids.deletedFor].sort())

    const res = await purgeExpiredTrash({ now: NOW })
    expect(res.errors).toEqual([])
    expect(mineIds(res.articleIds).sort()).toEqual([ids.deletedAgainst, ids.deletedFor].sort())
    // The other two debates still hold their articles.
    expect(retainedOf(res).map((a) => a.id)).toEqual([ids.activeFor, ids.unpubAgainst])
    expect((await hardDeleteAudits()).map((a) => a.targetId).sort()).toEqual(
      [ids.unrelatedExpired, ids.deletedFor, ids.deletedAgainst].sort(),
    )
  })

  it('a debate that starts referencing an article during the purge is still protected by the foreign key', async () => {
    await db.article.create({ data: { id: ids.raced, slug: ids.raced, title: ids.raced, content: 'body', authorId, deletedAt: daysAgo(50) } })
    const other = await db.article.create({
      data: { id: `${tag}-raced-other`, slug: `${tag}-raced-other`, title: 'other side', content: 'body', authorId, status: 'DRAFT' },
    })

    // A second connection inserts a debate referencing the article and holds the transaction open. Its
    // foreign-key check locks the article row (FOR KEY SHARE) but the row is not yet visibly referenced,
    // so the purge lists the article as purgeable and its DELETE then waits for that lock.
    const blocker = new Client({ connectionString: TEST_DB })
    await blocker.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query(
        `INSERT INTO debates (id, title, "forArticleId", "againstArticleId", "isActive", "updatedAt") VALUES ($1, $2, $3, $4, false, now())`,
        [debateIds.raced, `${tag} raced`, other.id, ids.raced],
      )
      const purge = purgeExpiredTrash({ now: NOW })

      const deadline = Date.now() + 10_000
      for (;;) {
        const { rows } = await blocker.query(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`,
        )
        if (rows[0].n > 0) break
        if (Date.now() > deadline) throw new Error('the purge never reached the delete of the raced article')
        await new Promise((r) => setTimeout(r, 25))
      }
      await blocker.query('COMMIT')

      const res = await purge
      expect(mineIds(res.articleIds)).toEqual([])
      const failure = res.errors.find((e) => e.articleId === ids.raced)
      expect(failure?.message).toMatch(/debates_againstArticleId_fkey|foreign key/i)
    } finally {
      await blocker.query('ROLLBACK').catch(() => {})
      await blocker.end()
    }

    // Nothing was lost: the article, the new debate, and no audit row claiming a deletion.
    expect(await db.article.count({ where: { id: ids.raced } })).toBe(1)
    expect(await db.debate.count({ where: { id: debateIds.raced } })).toBe(1)
    expect((await hardDeleteAudits()).map((a) => a.targetId)).not.toContain(ids.raced)

    // And the next run classifies it correctly: retained, not an error.
    const next = await purgeExpiredTrash({ now: NOW })
    expect(next.errors).toEqual([])
    expect(retainedOf(next).find((a) => a.id === ids.raced)).toEqual({
      id: ids.raced, deletedAt: daysAgo(50).toISOString(), reason: 'referenced-by-debate',
      debates: [{ debateId: debateIds.raced, position: 'against' }],
    })
  })
})
