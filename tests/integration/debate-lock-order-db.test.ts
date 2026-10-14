/**
 * Issue #128: lock order between the hidden-debate guard trigger, the debate lifecycle and voting, on a REAL
 * Postgres with real concurrent transactions.
 *
 * articles_hidden_debate_guard runs inside every write that makes an article public: the UPDATE has already locked
 * the article row, then the trigger takes FOR SHARE on the article's debates (article -> debate). Before the fix the
 * lifecycle wrote the debate first and its articles second (debate -> article), so an article save racing a hide or
 * delete could deadlock and return a 500. Every transaction that locks both now takes the articles first.
 *
 * The barrier tests hold a row lock on a separate connection to force the exact interleaving that used to deadlock,
 * and assert that the lifecycle (or vote) waits for it while holding NO debate lock. The randomised run repeats the
 * real routes with varied timing. Deadlocks must be prevented by the order, not hidden by the retry: every test
 * asserts that no transaction had to be retried, except the one that provokes a deadlock on purpose.
 *
 *   npm run test:setup-db      (or any local database built from the migrations)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client, Pool } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
// Every connection this suite opens carries this name, so lock waits are counted for this suite only.
const APP = 'debate-lock-order-test'

async function ready(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(
      `select 1 from pg_trigger where tgname in ('articles_hidden_debate_guard', 'articles_clear_hidden_by_debate')`,
    )
    return rowCount === 2
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
// Under the isolated launcher the database is built from every migration, so a missing trigger is a real defect.
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('the debate guard triggers are not installed in the isolated test database')
if (!isReady) console.warn('[debate-lock-order-db] skipped: no local test database with the debate guard triggers')
const suite = isReady ? describe : describe.skip

const { state, cache, sessions } = await vi.hoisted(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  const { createFakeNextCache } = await import('../helpers/fakeNextCache')
  const { AsyncLocalStorage } = await import('node:async_hooks')
  // Concurrent route calls act as different users: the session is bound per call, not shared.
  const sessions = new AsyncLocalStorage<{ id: string } | null>()
  return { state: { prisma: undefined as unknown }, cache: createFakeNextCache(), sessions }
})
vi.mock('next/cache', () => ({ unstable_cache: cache.unstable_cache, revalidateTag: cache.revalidateTag, revalidatePath: cache.revalidatePath }))
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }) }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => { const s = sessions.getStore(); return s ? { user: { id: s.id } } : null } }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
vi.mock('@/lib/email', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/email')>()), sendEmail: vi.fn(async () => true) }))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements: vi.fn() }))

import { PUT as saveArticle } from '@/app/api/articles/[id]/route'
import { POST as lifecycle } from '@/app/api/editorial/debates/[debateId]/lifecycle/route'
import { POST as voteRoute } from '@/app/api/debates/[debateId]/vote/route'
import { POST as featureArticle } from '@/app/api/editorial/articles/[id]/feature/route'
import { PATCH as editDebate } from '@/app/api/editorial/debates/[debateId]/route'
import { transitionDebate } from '@/lib/debateLifecycle'

let db: PrismaClient
const tag = `lo-${Date.now()}`
const ids = { admin: '', editor: '', writer: '', readers: [] as string[] }
let n = 0
const holders: Client[] = []
// Featuring is global (one featured debate, one featured article): what was featured before this suite is restored
// after it, so later suites and the browser tests sharing this database see the seeded state.
const featuredBefore = { debates: [] as string[], articles: [] as string[] }

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
const request = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** Runs a route call as `userId` (null: anonymous) for the whole of that call, however it interleaves with others. */
const runAs = <T>(userId: string | null, call: () => Promise<T>): Promise<T> => sessions.run(userId ? { id: userId } : null, call)
async function lifecycleAs(userId: string, debateId: string, body: Record<string, unknown>) {
  const res = await runAs(userId, () => lifecycle(request(`/api/editorial/debates/${debateId}/lifecycle`, 'POST', body), { params: Promise.resolve({ debateId }) }))
  return { status: res.status, body: await res.json() }
}
async function saveAs(userId: string, articleId: string, body: Record<string, unknown>) {
  const res = await runAs(userId, () => saveArticle(request(`/api/articles/${articleId}`, 'PUT', body), { params: Promise.resolve({ id: articleId }) }))
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function voteAs(userId: string | null, debateId: string, side: 'FOR' | 'AGAINST', ip = '203.0.113.7') {
  const res = await runAs(userId, () => voteRoute(request(`/api/debates/${debateId}/vote`, 'POST', { side }, { 'x-forwarded-for': ip }), { params: Promise.resolve({ debateId }) }))
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** A separate connection that plays the other transaction. Closed after each test. */
async function holder(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DB, application_name: APP })
  await client.connect()
  holders.push(client)
  return client
}

/** Waits until `count` backends of this database are blocked on a lock. */
async function lockWaiters(count: number, timeoutMs = 5_000): Promise<void> {
  const probe = await holder()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { rows } = await probe.query(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and application_name = $1 and wait_event_type = 'Lock'`,
      [APP],
    )
    if (rows[0].n >= count) return
    if (Date.now() > deadline) throw new Error(`expected ${count} lock waiter(s), saw ${rows[0].n}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** True when some other transaction holds a lock on the debate row that conflicts with FOR SHARE (what the guard needs). */
async function debateBlocksTheGuard(debateId: string): Promise<boolean> {
  const probe = await holder()
  await probe.query('BEGIN')
  try {
    await probe.query('SELECT 1 FROM debates WHERE id = $1 FOR SHARE NOWAIT', [debateId])
    return false
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return true
    throw error
  } finally {
    await probe.query('ROLLBACK').catch(() => {})
  }
}

/** A published debate with two PUBLISHED articles (created before the debate, so the guard has nothing to refuse). */
async function makeDebate() {
  const k = ++n
  const mk = (side: string) => db.article.create({
    data: {
      title: `${tag} ${k} ${side} capybara`, slug: `${tag}-${k}-${side}`, content: '{}', excerpt: 'capybara',
      authorId: ids.writer, status: 'PUBLISHED', publishedAt: new Date(), isDebate: true,
    },
  })
  const a = await mk('for')
  const b = await mk('against')
  const debate = await db.debate.create({ data: { title: `${tag} debate ${k}`, forArticleId: a.id, againstArticleId: b.id, isActive: true } })
  const [low, high] = [a.id, b.id].sort()
  return { debate, a, b, low, high }
}

/**
 * The invariants that must hold after any interleaving:
 *   - no article of an unpublished or deleted debate is PUBLISHED or SCHEDULED (and not trashed);
 *   - the "hidden by the debate" marker only ever sits on an ARCHIVED article.
 */
async function assertConsistent() {
  const exposed = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM articles a JOIN debates d ON d."forArticleId" = a.id OR d."againstArticleId" = a.id
     WHERE a.slug LIKE ${tag + '%'} AND (d."deletedAt" IS NOT NULL OR d."unpublishedAt" IS NOT NULL)
       AND a.status IN ('PUBLISHED', 'SCHEDULED') AND a."deletedAt" IS NULL`
  expect(exposed).toEqual([])
  const strayMarkers = await db.article.count({ where: { slug: { startsWith: tag }, hiddenByDebateAt: { not: null }, status: { not: 'ARCHIVED' } } })
  expect(strayMarkers).toBe(0)
}

const warn = vi.spyOn(console, 'warn')
const retries = () => warn.mock.calls.filter((call) => call[0] === '[transaction-retry]')

suite('debate lifecycle, article saves and votes share one lock order (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB!, application_name: APP }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'EDITOR' | 'WRITER' | 'READER') =>
      db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    ids.admin = (await mk('admin', 'ADMIN')).id
    ids.editor = (await mk('editor', 'EDITOR')).id
    ids.writer = (await mk('writer', 'WRITER')).id
    for (let i = 0; i < 4; i++) ids.readers.push((await mk(`reader${i}`, 'READER')).id)
    featuredBefore.debates = (await db.debate.findMany({ where: { isActive: true }, select: { id: true } })).map((d) => d.id)
    featuredBefore.articles = (await db.article.findMany({ where: { isFeatured: true }, select: { id: true } })).map((a) => a.id)
  })
  beforeEach(() => { cache.reset(); warn.mockClear() })
  afterEach(async () => {
    for (const client of holders.splice(0)) {
      await client.query('ROLLBACK').catch(() => {})
      await client.end().catch(() => {})
    }
  })
  afterAll(async () => {
    const debates = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    const people = [ids.admin, ids.editor, ids.writer, ...ids.readers]
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: debates.map((d) => d.id) } }, { performedBy: { in: people } }] } })
    await db.notification.deleteMany({ where: { userId: { in: people } } })
    await db.debateVote.deleteMany({ where: { debateId: { in: debates.map((d) => d.id) } } })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.articleTag.deleteMany({ where: { article: { slug: { startsWith: tag } } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.debate.updateMany({ where: { id: { in: featuredBefore.debates } }, data: { isActive: true } })
    await db.article.updateMany({ where: { id: { in: featuredBefore.articles } }, data: { isFeatured: true } })
    await db.$disconnect()
  })

  describe('the hazard, at the database level', () => {
    it('the guard still blocks: a writer that locks the debate before its article deadlocks against an article save', async () => {
      // This is the pre-fix lifecycle order, replayed in SQL. It proves the reproduction, and that the trigger still
      // takes a blocking FOR SHARE on the debate (weakening it to FOR KEY SHARE would make this test fail).
      const { debate, a, b } = await makeDebate()
      const admin = await holder()
      const editor = await holder()
      for (const c of [admin, editor]) {
        await c.query('BEGIN')
        await c.query(`SET LOCAL deadlock_timeout = '200ms'`)
      }
      await admin.query(`UPDATE debates SET "unpublishedAt" = now() WHERE id = $1`, [debate.id]) // admin holds the debate
      const save = editor.query(`UPDATE articles SET status = 'PUBLISHED', title = title || ' edited' WHERE id = $1`, [a.id]) // holds A, waits for the debate
      await lockWaiters(1)
      const hide = admin.query(`UPDATE articles SET status = 'ARCHIVED' WHERE id IN ($1, $2) AND status = 'PUBLISHED'`, [a.id, b.id]) // wants A
      const outcomes = await Promise.allSettled([save, hide])
      const deadlocks = outcomes.filter((o) => o.status === 'rejected' && (o.reason as { code?: string }).code === '40P01')
      expect(deadlocks).toHaveLength(1)
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    })
  })

  describe('lifecycle versus an in-flight article save', () => {
    it.each(['unpublish', 'delete'] as const)('%s waits for the article save while holding no debate lock, then hides both articles', async (action) => {
      const { debate, a, b } = await makeDebate()
      const save = await holder()
      await save.query('BEGIN')
      await save.query(`SET LOCAL statement_timeout = '3s'`)
      await save.query('SELECT 1 FROM articles WHERE id = $1 FOR NO KEY UPDATE', [a.id]) // the save's row lock, taken before the guard runs

      const hide = lifecycleAs(ids.admin, debate.id, { action })
      await lockWaiters(1)
      expect(await debateBlocksTheGuard(debate.id)).toBe(false) // pre-fix, the lifecycle held the debate here

      // The guard inside the save now needs FOR SHARE on the debate: it must be granted at once, not wait for the lifecycle.
      await save.query(`UPDATE articles SET status = 'PUBLISHED', title = title || ' edited' WHERE id = $1`, [a.id])
      await save.query('COMMIT')

      const res = await hide
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ action, articlesChanged: 2 })
      const rows = await db.article.findMany({ where: { id: { in: [a.id, b.id] } } })
      expect(rows.map((r) => r.status)).toEqual(['ARCHIVED', 'ARCHIVED'])
      expect(rows.every((r) => r.hiddenByDebateAt !== null)).toBe(true)
      expect(rows.find((r) => r.id === a.id)!.title).toMatch(/ edited$/) // the editor's committed save was kept
      await assertConsistent()
      expect(retries()).toEqual([])
    })

    it('publish waits for the article save; the save cannot make the article public before the debate is', async () => {
      const { debate, a, b } = await makeDebate()
      await transitionDebate({ id: ids.admin }, debate.id, 'unpublish')
      const save = await holder()
      await save.query('BEGIN')
      await save.query(`SET LOCAL statement_timeout = '3s'`)
      await save.query('SELECT 1 FROM articles WHERE id = $1 FOR NO KEY UPDATE', [a.id])

      const show = lifecycleAs(ids.admin, debate.id, { action: 'publish' })
      await lockWaiters(1)
      expect(await debateBlocksTheGuard(debate.id)).toBe(false)

      const refused = await save.query(`UPDATE articles SET status = 'PUBLISHED' WHERE id = $1`, [a.id]).catch((e) => e)
      expect(refused).toMatchObject({ code: '23514' }) // the guard judged the debate still hidden, without waiting
      expect(String(refused.message)).toContain('HIDDEN_DEBATE_ARTICLE')
      await save.query('ROLLBACK')

      const res = await show
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ action: 'publish', articlesChanged: 2, articlesNotRestored: 0 })
      const rows = await db.article.findMany({ where: { id: { in: [a.id, b.id] } } })
      expect(rows.map((r) => [r.status, r.hiddenByDebateAt])).toEqual([['PUBLISHED', null], ['PUBLISHED', null]])
      await assertConsistent()
      expect(retries()).toEqual([])
    })

    it.each(['restore', 'purge'] as const)('%s of a deleted debate waits for an in-flight article change', async (action) => {
      const { debate, a, b } = await makeDebate()
      await transitionDebate({ id: ids.admin }, debate.id, 'delete')
      const edit = await holder()
      await edit.query('BEGIN')
      await edit.query(`SET LOCAL statement_timeout = '3s'`)
      await edit.query('SELECT 1 FROM articles WHERE id = $1 FOR NO KEY UPDATE', [b.id])

      const pending = lifecycleAs(ids.admin, debate.id, { action, confirmTitle: debate.title })
      await lockWaiters(1)
      expect(await debateBlocksTheGuard(debate.id)).toBe(false)
      // An attempt to publish the article while it waits is judged at once and refused (the debate is deleted).
      const refused = await edit.query(`UPDATE articles SET status = 'PUBLISHED' WHERE id = $1`, [b.id]).catch((e) => e)
      expect(refused).toMatchObject({ code: '23514' })
      await edit.query('ROLLBACK')

      const res = await pending
      expect(res.status).toBe(200)
      if (action === 'purge') {
        expect(await db.debate.count({ where: { id: debate.id } })).toBe(0)
        expect(await db.article.count({ where: { id: { in: [a.id, b.id] }, deletedAt: { not: null } } })).toBe(2)
      } else {
        expect(await db.debate.findUniqueOrThrow({ where: { id: debate.id } })).toMatchObject({ deletedAt: null })
      }
      await assertConsistent()
      expect(retries()).toEqual([])
    })
  })

  describe('voting is a third participant and adds no cycle', () => {
    it('a vote and a hide queued behind the same article both finish; the vote is refused once the debate is hidden', async () => {
      // The lifecycle takes the lower-id article, then waits for the higher one. Pre-fix, the vote then took the debate
      // first and waited for the lower article: lifecycle -> vote -> lifecycle, a deadlock.
      const { debate, high } = await makeDebate()
      const other = await holder()
      await other.query('BEGIN')
      await other.query('SELECT 1 FROM articles WHERE id = $1 FOR NO KEY UPDATE', [high])

      const hide = lifecycleAs(ids.admin, debate.id, { action: 'unpublish' })
      await lockWaiters(1)
      const vote = voteAs(ids.readers[0], debate.id, 'FOR')
      await lockWaiters(2)
      await other.query('ROLLBACK')

      const [hidden, voted] = await Promise.all([hide, vote])
      expect(hidden.status).toBe(200)
      expect(voted.status).toBe(404) // it re-checked after the hide committed
      expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(0)
      await assertConsistent()
      expect(retries()).toEqual([])
    })

    it('a vote, an article save and a hide on the same debate all complete without a deadlock', async () => {
      const { debate, a } = await makeDebate()
      const save = await holder()
      await save.query('BEGIN')
      await save.query(`SET LOCAL statement_timeout = '3s'`)
      await save.query('SELECT 1 FROM articles WHERE id = $1 FOR NO KEY UPDATE', [a.id])

      const vote = voteAs(ids.readers[1], debate.id, 'AGAINST')
      await lockWaiters(1)
      const hide = lifecycleAs(ids.admin, debate.id, { action: 'delete' })
      await lockWaiters(2)
      expect(await debateBlocksTheGuard(debate.id)).toBe(false)
      await save.query(`UPDATE articles SET status = 'PUBLISHED', title = title || ' edited' WHERE id = $1`, [a.id])
      await save.query('COMMIT')

      const [voted, hidden] = await Promise.all([vote, hide])
      expect(hidden.status).toBe(200)
      expect([200, 404]).toContain(voted.status) // either order is correct; both must finish
      expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(voted.status === 200 ? 1 : 0)
      await assertConsistent()
      expect(retries()).toEqual([])
    })
  })

  describe('other writers that lock several debate articles or debates', () => {
    it('featuring an article locks in id order: a vote holding the debate\'s articles is not deadlocked by it', async () => {
      // Articles Q < P of one debate; Q is the featured article; an editor features P. Before the fix the feature route
      // locked P, then Q. A vote locks Q, then P. With a reader holding Q (FOR SHARE: the vote may share it, the feature
      // may not), the feature held P and waited for Q while the vote held Q and waited for P.
      const { debate, low: q, high: p } = await makeDebate()
      await db.article.updateMany({ where: { isFeatured: true }, data: { isFeatured: false } })
      await db.article.update({ where: { id: q }, data: { isFeatured: true } })
      const reader = await holder()
      await reader.query('BEGIN')
      await reader.query('SELECT 1 FROM articles WHERE id = $1 FOR SHARE', [q])

      const feature = runAs(ids.admin, () => featureArticle(request(`/api/editorial/articles/${p}/feature`, 'POST'), { params: Promise.resolve({ id: p }) }))
      await lockWaiters(1)
      const vote = voteAs(ids.readers[0], debate.id, 'FOR')
      expect((await vote).status).toBe(200) // it did not wait for the feature: P was not locked yet
      await reader.query('ROLLBACK')
      expect((await feature).status).toBe(200)
      expect((await db.article.findMany({ where: { id: { in: [q, p] } }, orderBy: { id: 'asc' } })).map((r) => r.isFeatured)).toEqual([false, true])
      expect(retries()).toEqual([])
    })

    it('two administrators featuring different debates at once: never a 5xx, exactly one featured debate', async () => {
      for (let i = 0; i < 15; i++) {
        const [one, two] = [await makeDebate(), await makeDebate()]
        const feature = (id: string) => runAs(ids.admin, async () => {
          const res = await editDebate(request(`/api/editorial/debates/${id}`, 'PATCH', { isActive: true }), { params: Promise.resolve({ debateId: id }) })
          return res.status
        })
        expect(await Promise.all([feature(one.debate.id), feature(two.debate.id)])).toEqual([200, 200])
        expect(await db.debate.count({ where: { isActive: true } })).toBe(1)
      }
      expect(retries()).toEqual([])
    })

    it('featuring a debate leaves every other debate\'s revision alone (only the featured one changes)', async () => {
      const bystander = await makeDebate()
      await db.debate.update({ where: { id: bystander.debate.id }, data: { isActive: false } })
      const before = (await db.debate.findUniqueOrThrow({ where: { id: bystander.debate.id } })).updatedAt
      const { debate } = await makeDebate()
      const res = await runAs(ids.admin, () => editDebate(request(`/api/editorial/debates/${debate.id}`, 'PATCH', { isActive: true }), { params: Promise.resolve({ debateId: debate.id }) }))
      expect(res.status).toBe(200)
      expect((await db.debate.findUniqueOrThrow({ where: { id: bystander.debate.id } })).updatedAt).toEqual(before)
    })
  })

  describe('randomised interleavings of the real routes', () => {
    it('50 races of saves, hides, shows and votes: never a 5xx, never a public article of a hidden debate', async () => {
      // A vote that waits longer than its lock timeout is told to try again (503 DATABASE_BUSY): a designed answer, not
      // an error, and possible on a heavily loaded runner. Nothing else may be a 5xx.
      const ALLOWED: Record<string, number[]> = { save: [200, 409], lifecycle: [200, 409], vote: [200, 404, 409, 503] }
      const ALLOWED_409 = new Set(['ARTICLE_CHANGED', 'HIDDEN_DEBATE_ARTICLE', 'CONFLICT', 'INVALID_STATE', 'ALREADY_VOTED', undefined])
      const jitter = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8)))
      const seen: string[] = []
      for (let i = 0; i < 50; i++) {
        const { debate, a, b } = await makeDebate()
        const startsHidden = i % 3 === 2
        if (startsHidden) await transitionDebate({ id: ids.admin }, debate.id, 'unpublish')
        const hideAction = i % 2 === 0 ? 'unpublish' : 'delete'
        const ops: Array<{ kind: keyof typeof ALLOWED; run: () => Promise<{ status: number; body: { code?: string } }> }> = [
          { kind: 'save', run: () => saveAs(ids.editor, a.id, { title: `${tag} ${i} edited A`, status: 'PUBLISHED', publicationIntent: true }) },
          { kind: 'save', run: () => saveAs(ids.admin, b.id, { excerpt: `edited ${i}`, status: 'PUBLISHED', publicationIntent: true }) },
          { kind: 'lifecycle', run: () => lifecycleAs(ids.admin, debate.id, { action: startsHidden ? 'publish' : hideAction }) },
          { kind: 'vote', run: () => voteAs(ids.readers[i % ids.readers.length], debate.id, i % 2 ? 'FOR' : 'AGAINST') },
          { kind: 'vote', run: () => voteAs(null, debate.id, 'FOR', `198.51.100.${i}`) },
        ]
        ops.sort(() => Math.random() - 0.5)
        const results = await Promise.all(ops.map(async (op) => { await jitter(); return { kind: op.kind, ...(await op.run()) } }))
        for (const r of results) {
          seen.push(`${r.kind}:${r.status}`)
          expect(ALLOWED[r.kind], `${r.kind} returned ${r.status} ${JSON.stringify(r.body)}`).toContain(r.status)
          if (r.status === 409) expect(ALLOWED_409.has(r.body.code), JSON.stringify(r.body)).toBe(true)
          if (r.status === 503) expect(r.body.code).toBe('DATABASE_BUSY')
        }
        await assertConsistent()
        // A vote is recorded only for a debate that was public when it committed: the hide/show is a total order with it.
        const finalDebate = await db.debate.findUniqueOrThrow({ where: { id: debate.id } })
        const votes = await db.debateVote.count({ where: { debateId: debate.id } })
        expect(votes).toBeLessThanOrEqual(2)
        if (startsHidden && finalDebate.unpublishedAt) expect(votes).toBe(0)
      }
      expect(retries()).toEqual([]) // prevented by the lock order, not masked by retries
      // The run must actually have produced contention outcomes, not 50 trivially serial ones.
      expect(seen.filter((s) => s.startsWith('lifecycle:200')).length).toBeGreaterThan(40)
    }, 120_000)
  })

  describe('defence in depth', () => {
    it('a lifecycle transaction that PostgreSQL aborts with a deadlock is retried once and then succeeds', { timeout: 15_000 }, async () => {
      // A hostile writer that still uses the old order (debate, then article). The lifecycle waits on the debate while
      // holding the articles; the hostile writer then asks for an article. The lifecycle's deadlock check fires first,
      // so it is the victim; its retry waits behind the hostile writer and then applies.
      // PostgreSQL checks for a deadlock once, when a waiter's deadlock_timeout expires. The lifecycle's connections use
      // 2 s and the hostile writer 30 s, so the lifecycle is the one that finds the cycle even on a slow runner.
      const pool = new Pool({ connectionString: TEST_DB!, application_name: APP })
      pool.on('connect', (client) => { void client.query(`SET deadlock_timeout = '2s'`) })
      const victim = new PrismaClient({ adapter: new PrismaPg(pool) })
      state.prisma = victim
      try {
        const { debate, a, b } = await makeDebate()
        const hostile = await holder()
        await hostile.query('BEGIN')
        await hostile.query(`SET LOCAL deadlock_timeout = '30s'`)
        await hostile.query('SELECT 1 FROM debates WHERE id = $1 FOR NO KEY UPDATE', [debate.id])

        const hide = lifecycleAs(ids.admin, debate.id, { action: 'unpublish' })
        await lockWaiters(1)
        await hostile.query('SELECT 1 FROM articles WHERE id = $1 FOR NO KEY UPDATE', [a.id]) // returns once the lifecycle is aborted
        await hostile.query('COMMIT')

        const res = await hide
        expect(res.status).toBe(200)
        expect(retries()).toHaveLength(1)
        expect(retries()[0][1]).toMatchObject({ operation: 'debate:unpublish', code: '40P01', attempt: 1 })
        expect(await db.article.count({ where: { id: { in: [a.id, b.id] }, status: 'ARCHIVED' } })).toBe(2)
        expect(await db.auditLog.count({ where: { targetId: debate.id, action: 'DEBATE_UNPUBLISHED' } })).toBe(1) // applied once
        await assertConsistent()
      } finally {
        state.prisma = db
        await victim.$disconnect()
        await pool.end().catch(() => {})
      }
    })
  })

  describe('vote transaction bounds and duplicate votes (#129)', () => {
    it('a vote blocked by a held lock fails fast with 503 DATABASE_BUSY and records nothing', async () => {
      const { debate, a } = await makeDebate()
      const blocker = await holder()
      await blocker.query('BEGIN')
      await blocker.query('SELECT 1 FROM articles WHERE id = $1 FOR UPDATE', [a.id])

      const started = Date.now()
      const res = await voteAs(ids.readers[2], debate.id, 'FOR')
      const elapsed = Date.now() - started
      expect(res.status).toBe(503)
      expect(res.body).toMatchObject({ code: 'DATABASE_BUSY' })
      expect(elapsed).toBeLessThan(4_000) // well inside the 5 s transaction timeout; without lock_timeout it waits forever
      expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(0)
      expect(retries()).toEqual([]) // a busy lock is not retried

      await blocker.query('ROLLBACK')
      const again = await voteAs(ids.readers[2], debate.id, 'FOR')
      expect(again.status).toBe(200)
      expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(1)
    })

    it('concurrent duplicate votes by one member: exactly one is stored, the rest get 409 ALREADY_VOTED', async () => {
      const { debate } = await makeDebate()
      const sides = ['FOR', 'AGAINST', 'FOR', 'AGAINST', 'FOR', 'AGAINST'] as const
      const results = await Promise.all(sides.map((side) => voteAs(ids.readers[3], debate.id, side)))
      const ok = results.filter((r) => r.status === 200)
      expect(ok).toHaveLength(1)
      for (const r of results.filter((r) => r.status !== 200)) expect(r).toMatchObject({ status: 409, body: { code: 'ALREADY_VOTED' } })
      const stored = await db.debateVote.findMany({ where: { debateId: debate.id } })
      expect(stored).toHaveLength(1)
      expect(stored[0].side).toBe(ok[0].body.userSide) // the first vote stands; nothing overwrote it
    })

    it('an anonymous repeat from the same address is refused and never overwrites the stored vote', async () => {
      const { debate } = await makeDebate()
      const first = await voteAs(null, debate.id, 'FOR', '192.0.2.44')
      expect(first.status).toBe(200)
      const repeat = await voteAs(null, debate.id, 'AGAINST', '192.0.2.44') // new cookie id, same IP hash
      expect(repeat).toMatchObject({ status: 409, body: { code: 'ALREADY_VOTED' } })
      const stored = await db.debateVote.findMany({ where: { debateId: debate.id } })
      expect(stored.map((v) => v.side)).toEqual(['FOR'])
    })
  })
})
