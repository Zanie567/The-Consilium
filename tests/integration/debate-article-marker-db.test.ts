/**
 * `articles.hiddenByDebateAt`: which articles a debate hid automatically, so that publishing the debate again
 * restores exactly those and nothing an editor decided on purpose. Real Postgres, real lifecycle code, the real
 * article editor route, the real database triggers.
 *
 * Rules under test (migration 20261012100000):
 *   - only the debate lifecycle sets the marker (the same UPDATE that archives a PUBLISHED article);
 *   - any other status or trash change clears it, whichever code or SQL makes the change;
 *   - "publish" restores only ARCHIVED, non-trashed articles that still carry it;
 *   - repeated lifecycle actions are idempotent; concurrent editorial changes are never overwritten;
 *   - SCHEDULED articles are never touched, are never published while the debate is hidden, and are published
 *     by the scheduler once the debate is public again;
 *   - articles_hidden_debate_guard keeps refusing publication of a hidden debate's articles.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL

async function ready(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(`select 1 from pg_trigger where tgname = 'articles_clear_hidden_by_debate'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
// Under the isolated launcher the database is built from every migration: a missing trigger is a defect, not a skip.
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('articles_clear_hidden_by_debate is not installed in the isolated test database')
if (!isReady) console.warn('[debate-article-marker-db] skipped: migration 20261012100000 is not applied to this database')
const suite = isReady ? describe : describe.skip

const { state, cache } = await vi.hoisted(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  const { createFakeNextCache } = await import('../helpers/fakeNextCache')
  return { state: { prisma: undefined as unknown, session: null as null | { id: string } }, cache: createFakeNextCache() }
})
vi.mock('next/cache', () => ({ unstable_cache: cache.unstable_cache, revalidateTag: cache.revalidateTag, revalidatePath: cache.revalidatePath }))
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }) }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
vi.mock('@/lib/email', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/email')>()), sendEmail: vi.fn(async () => true) }))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements: vi.fn() }))

import { PUT as saveArticle } from '@/app/api/articles/[id]/route'
import { transitionDebate, DebateLifecycleError } from '@/lib/debateLifecycle'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { isHiddenDebateViolation } from '@/lib/hiddenDebateGuard'

let db: PrismaClient
const tag = `hm-${Date.now()}`
const ids = { admin: '', editor: '', writer: '' }
let n = 0
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

type Status = 'PUBLISHED' | 'ARCHIVED' | 'DRAFT' | 'SCHEDULED'
/** A PUBLIC debate (the normal starting point). Each side can start in a different state. */
async function makeDebate(sides: { for?: Status; against?: Status } = {}) {
  const k = ++n
  const mk = (side: 'for' | 'against') => {
    const status = sides[side] ?? 'PUBLISHED'
    return db.article.create({
      data: {
        title: `${tag} ${k} ${side} okapi`, slug: `${tag}-${k}-${side}`, content: '{}', excerpt: 'okapi', authorId: ids.writer, isDebate: true,
        status, publishedAt: status === 'PUBLISHED' || status === 'ARCHIVED' ? new Date() : null,
        scheduledAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000) : null,
      },
    })
  }
  const [a, b] = await Promise.all([mk('for'), mk('against')])
  const debate = await db.debate.create({ data: { title: `${tag} debate ${k}`, forArticleId: a.id, againstArticleId: b.id, isActive: false } })
  return { debate, a, b }
}
const row = (id: string) => db.article.findUniqueOrThrow({ where: { id } })
const act = (debateId: string, action: 'unpublish' | 'publish' | 'delete' | 'restore' | 'purge', title?: string) =>
  transitionDebate({ id: ids.admin }, debateId, action, title ? { confirmTitle: title } : {})

/** Run SQL as a separate connection so a transaction can be held open while the lifecycle runs. */
async function withConnection<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_DB })
  await client.connect()
  try { return await fn(client) } finally { await client.end().catch(() => {}) }
}

suite('articles hidden by a debate are remembered, and only those are restored (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'EDITOR' | 'WRITER') => db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    ids.admin = (await mk('admin', 'ADMIN')).id
    ids.editor = (await mk('editor', 'EDITOR')).id
    ids.writer = (await mk('writer', 'WRITER')).id
  })
  beforeEach(() => { cache.reset(); state.session = { id: ids.editor } })
  afterAll(async () => {
    const debates = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: debates.map((d) => d.id) } }, { performedBy: { in: Object.values(ids) } }] } })
    await db.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('unpublish marks exactly the articles it archived; publish restores them and clears the marker', async () => {
    const { debate, a, b } = await makeDebate()
    const hidden = await act(debate.id, 'unpublish')
    expect(hidden.articlesChanged).toBe(2)
    for (const id of [a.id, b.id]) {
      const r = await row(id)
      expect(r.status).toBe('ARCHIVED')
      expect(r.hiddenByDebateAt).toBeInstanceOf(Date)
    }
    const shown = await act(debate.id, 'publish')
    expect(shown).toMatchObject({ articlesChanged: 2, articlesNotRestored: 0, visibility: 'published' })
    for (const id of [a.id, b.id]) expect(await row(id)).toMatchObject({ status: 'PUBLISHED', hiddenByDebateAt: null })
  })

  it('an article an editor archived on purpose has no marker and is never restored; the administrator is told', async () => {
    const { debate, a, b } = await makeDebate({ against: 'ARCHIVED' }) // archived by an editor before anything else
    expect((await row(b.id)).hiddenByDebateAt).toBeNull()
    expect((await act(debate.id, 'unpublish')).articlesChanged).toBe(1) // only the PUBLISHED side was hidden
    expect((await row(a.id)).hiddenByDebateAt).toBeInstanceOf(Date)
    expect((await row(b.id)).hiddenByDebateAt).toBeNull()

    const shown = await act(debate.id, 'publish')
    expect(shown).toMatchObject({ articlesChanged: 1, articlesNotRestored: 1 })
    expect(await row(a.id)).toMatchObject({ status: 'PUBLISHED', hiddenByDebateAt: null })
    expect(await row(b.id)).toMatchObject({ status: 'ARCHIVED', hiddenByDebateAt: null }) // still archived
    const audit = await db.auditLog.findFirst({ where: { targetId: debate.id, action: 'DEBATE_PUBLISHED' } })
    expect(audit?.metadata).toMatchObject({ articlesChanged: 1, articlesNotRestored: 1 })
  })

  it('is idempotent: repeating, interleaving and cycling actions never changes the outcome or re-marks', async () => {
    const { debate, a, b } = await makeDebate()
    await act(debate.id, 'unpublish')
    const marked = (await row(a.id)).hiddenByDebateAt
    // A second unpublish is refused (already hidden) and changes nothing.
    await expect(act(debate.id, 'unpublish')).rejects.toBeInstanceOf(DebateLifecycleError)
    // Delete after unpublish: the articles are already archived, so nothing is re-marked and the first marker survives.
    expect((await act(debate.id, 'delete')).articlesChanged).toBe(0)
    expect((await row(a.id)).hiddenByDebateAt?.getTime()).toBe(marked?.getTime())
    await act(debate.id, 'restore')
    expect(await row(a.id)).toMatchObject({ status: 'ARCHIVED' })
    expect((await act(debate.id, 'publish')).articlesChanged).toBe(2)
    // Publishing again is refused and a further cycle behaves identically.
    await expect(act(debate.id, 'publish')).rejects.toBeInstanceOf(DebateLifecycleError)
    for (let i = 0; i < 3; i++) {
      await act(debate.id, 'unpublish')
      expect(await db.article.count({ where: { id: { in: [a.id, b.id] }, status: 'ARCHIVED', hiddenByDebateAt: { not: null } } })).toBe(2)
      await act(debate.id, 'publish')
      expect(await db.article.count({ where: { id: { in: [a.id, b.id] }, status: 'PUBLISHED', hiddenByDebateAt: null } })).toBe(2)
    }
  })

  describe('a deliberate editorial decision always wins', () => {
    it('re-drafting a hidden article through the real editor route clears the marker; publish leaves it a draft', async () => {
      const { debate, a, b } = await makeDebate()
      await act(debate.id, 'unpublish')
      const res = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'DRAFT' }), ctx(a.id))
      expect(res.status).toBe(200)
      expect(await row(a.id)).toMatchObject({ status: 'DRAFT', hiddenByDebateAt: null })
      const shown = await act(debate.id, 'publish')
      expect(shown).toMatchObject({ articlesChanged: 1, articlesNotRestored: 1 })
      expect((await row(a.id)).status).toBe('DRAFT')
      expect((await row(b.id)).status).toBe('PUBLISHED')
    })

    it('trashing a hidden article, or trashing and restoring it, clears the marker: it is never silently republished', async () => {
      const { debate, a, b } = await makeDebate()
      await act(debate.id, 'unpublish')
      await db.article.update({ where: { id: a.id }, data: { deletedAt: new Date() } }) // trash
      expect((await row(a.id)).hiddenByDebateAt).toBeNull()
      await db.article.update({ where: { id: a.id }, data: { deletedAt: null } }) // restored while the debate is still hidden
      expect(await row(a.id)).toMatchObject({ status: 'ARCHIVED', hiddenByDebateAt: null })
      await act(debate.id, 'publish')
      expect(await row(a.id)).toMatchObject({ status: 'ARCHIVED' })
      expect((await row(b.id)).status).toBe('PUBLISHED')
    })

    it('raw SQL gets the same rule: the database, not the application, clears the marker', async () => {
      const { debate, a } = await makeDebate()
      await act(debate.id, 'unpublish')
      await withConnection((c) => c.query(`update articles set status = 'REJECTED' where id = $1`, [a.id]))
      expect(await row(a.id)).toMatchObject({ status: 'REJECTED', hiddenByDebateAt: null })
    })

    it('saving a still-archived article without changing its status or trash state keeps the marker', async () => {
      const { debate, a } = await makeDebate()
      await act(debate.id, 'unpublish')
      await db.article.update({ where: { id: a.id }, data: { title: `${tag} renamed`, status: 'ARCHIVED' } })
      expect((await row(a.id)).hiddenByDebateAt).toBeInstanceOf(Date)
      await act(debate.id, 'publish')
      expect((await row(a.id)).status).toBe('PUBLISHED')
    })

    it('the marker cannot be set through the editor API', async () => {
      const { a } = await makeDebate()
      const res = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { hiddenByDebateAt: new Date().toISOString(), status: 'PUBLISHED' }), ctx(a.id))
      expect([200, 400]).toContain(res.status)
      expect((await row(a.id)).hiddenByDebateAt).toBeNull()
    })
  })

  describe('concurrency: an editorial change racing a lifecycle action is never overwritten', () => {
    it('publish waits for an editor who is re-drafting the hidden article, then leaves it a draft', async () => {
      const { debate, a, b } = await makeDebate()
      await act(debate.id, 'unpublish')
      await withConnection(async (editor) => {
        await editor.query('begin')
        await editor.query(`update articles set status = 'DRAFT' where id = $1`, [a.id]) // marker cleared by the trigger, uncommitted
        const publishing = act(debate.id, 'publish')
        await new Promise((r) => setTimeout(r, 400)) // the lifecycle is now blocked on the row lock
        await editor.query('commit')
        const result = await publishing
        expect(result.articlesNotRestored).toBe(1)
      })
      expect(await row(a.id)).toMatchObject({ status: 'DRAFT', hiddenByDebateAt: null })
      expect((await row(b.id)).status).toBe('PUBLISHED')
    })

    it('unpublish waits for an editor who is drafting a published article, and does not archive over the editor', async () => {
      const { debate, a, b } = await makeDebate()
      await withConnection(async (editor) => {
        await editor.query('begin')
        await editor.query(`update articles set status = 'DRAFT' where id = $1`, [a.id])
        const hiding = act(debate.id, 'unpublish')
        await new Promise((r) => setTimeout(r, 400))
        await editor.query('commit')
        expect((await hiding).articlesChanged).toBe(1) // only the side the editor did not touch
      })
      expect(await row(a.id)).toMatchObject({ status: 'DRAFT', hiddenByDebateAt: null })
      expect(await row(b.id)).toMatchObject({ status: 'ARCHIVED' })
      expect((await row(b.id)).hiddenByDebateAt).toBeInstanceOf(Date)
    })
  })

  describe('SCHEDULED articles', () => {
    it('are untouched by unpublish, never published while hidden, and published by the scheduler once the debate is public', async () => {
      const { debate, a, b } = await makeDebate({ against: 'SCHEDULED' })
      await act(debate.id, 'unpublish')
      expect(await row(b.id)).toMatchObject({ status: 'SCHEDULED', hiddenByDebateAt: null }) // not archived, not marked
      expect((await row(a.id)).status).toBe('ARCHIVED')

      const whileHidden = await publishScheduledArticles(new Date())
      expect(whileHidden.published.map((p) => p.id)).not.toContain(b.id)
      expect(await row(b.id)).toMatchObject({ status: 'SCHEDULED' })
      expect(await db.article.count({ where: { id: b.id, status: 'PUBLISHED' } })).toBe(0)

      const shown = await act(debate.id, 'publish')
      expect(shown).toMatchObject({ articlesChanged: 1, articlesNotRestored: 1 }) // the scheduled side is not public yet
      expect((await row(b.id)).status).toBe('SCHEDULED') // publish does not publish it early or change it

      const afterwards = await publishScheduledArticles(new Date())
      expect(afterwards.published.map((p) => p.id)).toContain(b.id)
      expect(await row(b.id)).toMatchObject({ status: 'PUBLISHED' })
      expect((await row(a.id)).status).toBe('PUBLISHED')
    })
  })

  describe('the database guard still refuses publication of a hidden debate’s articles', () => {
    it('a marked article cannot be published directly, by the editor route or by SQL, and keeps its marker', async () => {
      const { debate, a } = await makeDebate()
      await act(debate.id, 'unpublish')
      const marked = (await row(a.id)).hiddenByDebateAt
      const viaRoute = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'PUBLISHED', publicationIntent: true }), ctx(a.id))
      expect(viaRoute.status).toBe(409)
      expect((await viaRoute.json()).code).toBe('HIDDEN_DEBATE_ARTICLE')
      const viaSql = await withConnection((c) => c.query(`update articles set status = 'PUBLISHED' where id = $1`, [a.id]).then(() => null, (e) => e))
      expect(isHiddenDebateViolation(viaSql)).toBe(true)
      // The refused writes rolled back entirely: still archived, marker intact, and a normal publish still restores it.
      expect(await row(a.id)).toMatchObject({ status: 'ARCHIVED' })
      expect((await row(a.id)).hiddenByDebateAt?.getTime()).toBe(marked?.getTime())
      await act(debate.id, 'publish')
      expect((await row(a.id)).status).toBe('PUBLISHED')
    })
  })

  it('a permanently deleted debate leaves its articles in the Trash without a stale marker', async () => {
    const { debate, a, b } = await makeDebate()
    await act(debate.id, 'delete')
    expect((await row(a.id)).hiddenByDebateAt).toBeInstanceOf(Date)
    await act(debate.id, 'purge', debate.title)
    for (const id of [a.id, b.id]) {
      const r = await row(id)
      expect(r.deletedAt).toBeInstanceOf(Date)
      expect(r.hiddenByDebateAt).toBeNull()
    }
  })
})
