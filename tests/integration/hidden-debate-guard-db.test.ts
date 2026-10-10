/**
 * The invariant: an article that belongs to an unpublished or deleted debate is never public.
 * Proven on a REAL Postgres against every route to publication (editor save, review approval,
 * trash restore, the scheduled-publish job), against raw SQL that bypasses the application, under
 * concurrency, and on the public read paths with the database trigger switched off (to model data
 * that predates it). The legitimate flow, publishing or restoring the debate itself, must keep working.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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
    const { rowCount } = await client.query(`select 1 from pg_trigger where tgname = 'articles_hidden_debate_guard'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
// Under the isolated launcher the database is built from every migration, so a missing guard is a
// real defect, never a reason to skip.
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('articles_hidden_debate_guard is not installed in the isolated test database')
if (!isReady) console.warn('[hidden-debate-guard-db] skipped: the articles_hidden_debate_guard trigger is not installed here')
const suite = isReady ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string } } }
})
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
import { PATCH as review } from '@/app/api/editorial/articles/[id]/review/route'
import { PATCH as restoreFromTrash } from '@/app/api/editorial/trash/[id]/route'
import { GET as feed } from '@/app/feed.xml/route'
import { GET as search } from '@/app/api/search/route'
import { GET as latest } from '@/app/api/latest-article/route'
import sitemap from '@/app/sitemap'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { transitionDebate } from '@/lib/debateLifecycle'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { isHiddenDebateViolation } from '@/lib/hiddenDebateGuard'
import { formatEditorialScheduleInput } from '@/lib/editorialSchedule'

let db: PrismaClient
const tag = `hd-${Date.now()}`
const ids = { admin: '', editor: '', writer: '' }
let n = 0
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const as = (id: string | null) => { state.session = id ? { id } : null }
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

/** A debate and its two articles, in any state. Direct inserts: the trigger only governs PUBLISHED/SCHEDULED + not trashed. */
async function makeDebate(opts: { hidden?: 'unpublished' | 'deleted' | null; articleStatus?: 'PUBLISHED' | 'ARCHIVED' | 'PENDING_REVIEW' | 'SCHEDULED'; trashed?: boolean } = {}) {
  const k = ++n
  const status = opts.articleStatus ?? 'ARCHIVED'
  const mk = (side: string) => db.article.create({
    data: {
      title: `${tag} ${k} ${side} quokka`, slug: `${tag}-${k}-${side}`, content: '{}', excerpt: 'quokka', authorId: ids.writer,
      status, publishedAt: status === 'PUBLISHED' || status === 'ARCHIVED' ? new Date() : null,
      scheduledAt: status === 'SCHEDULED' ? new Date(Date.now() - 60_000) : null,
      isDebate: true, deletedAt: opts.trashed ? new Date() : null,
    },
  })
  // The debate must exist BEFORE a PUBLISHED/SCHEDULED article could be refused, so create hidden-state debates first
  // would be impossible (they need the articles). Insert as ARCHIVED, make the debate, then set the status with the guard off.
  const [a, b] = await Promise.all([mk('for'), mk('against')])
  const hidden = opts.hidden ?? null
  const debate = await db.debate.create({
    data: {
      title: `${tag} debate ${k}`, forArticleId: a.id, againstArticleId: b.id, isActive: false,
      unpublishedAt: hidden ? new Date() : null, deletedAt: hidden === 'deleted' ? new Date() : null,
    },
  })
  return { debate, a, b }
}
const fresh = (id: string) => db.article.findUniqueOrThrow({ where: { id } })
const isPublic = async (id: string) => (await db.article.count({ where: { id, status: 'PUBLISHED', deletedAt: null } })) === 1

suite('hidden debate articles can never become public (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'EDITOR' | 'WRITER') => db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    ids.admin = (await mk('admin', 'ADMIN')).id
    ids.editor = (await mk('editor', 'EDITOR')).id
    ids.writer = (await mk('writer', 'WRITER')).id
  })
  beforeEach(() => as(ids.editor))
  afterAll(async () => {
    const debates = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: debates.map((d) => d.id) } }, { performedBy: { in: Object.values(ids) } }] } })
    await db.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  describe.each(['unpublished', 'deleted'] as const)('while the debate is %s', (hidden) => {
    it('the article editor cannot publish or schedule one of its articles', async () => {
      const { a } = await makeDebate({ hidden })
      const published = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'PUBLISHED', publicationIntent: true }), ctx(a.id))
      expect(published.status).toBe(409)
      expect((await published.json()).code).toBe('HIDDEN_DEBATE_ARTICLE')
      const when = formatEditorialScheduleInput(new Date(Date.now() + 3_600_000).toISOString())
      const scheduled = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'SCHEDULED', scheduledAt: when, publicationIntent: true }), ctx(a.id))
      expect(scheduled.status).toBe(409)
      const row = await fresh(a.id)
      expect(row).toMatchObject({ status: 'ARCHIVED', scheduledAt: null })
      expect(await isPublic(a.id)).toBe(false)
    })

    it('review approval is refused and the article stays pending', async () => {
      const { a } = await makeDebate({ hidden })
      await db.article.update({ where: { id: a.id }, data: { status: 'PENDING_REVIEW' } })
      const res = await review(json(`/api/editorial/articles/${a.id}/review`, 'PATCH', { action: 'approve' }), ctx(a.id))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('HIDDEN_DEBATE_ARTICLE')
      expect((await fresh(a.id)).status).toBe('PENDING_REVIEW')
      expect(await db.notification.count({ where: { articleId: a.id } })).toBe(0) // the failed approval left no notification behind
    })

    it('restoring a trashed article from Trash does not make it public', async () => {
      const { a } = await makeDebate({ hidden, articleStatus: 'PUBLISHED', trashed: true })
      const res = await restoreFromTrash(json(`/api/editorial/trash/${a.id}`, 'PATCH'), ctx(a.id))
      expect(res.status).toBe(409)
      const row = await fresh(a.id)
      expect(row.deletedAt).not.toBeNull()
      expect(await isPublic(a.id)).toBe(false)
    })

    it('the scheduled-publish job skips it, still publishes other due articles, and never aborts the run', async () => {
      const { a } = await makeDebate({ hidden, articleStatus: 'SCHEDULED' })
      const other = await db.article.create({ data: { title: `${tag} ordinary due`, slug: `${tag}-ordinary-${++n}`, content: '{}', authorId: ids.writer, status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 60_000) } })
      const result = await publishScheduledArticles()
      expect(result.published.map((p) => p.id)).toContain(other.id)
      expect(result.published.map((p) => p.id)).not.toContain(a.id)
      expect(await isPublic(a.id)).toBe(false)
      expect(await isPublic(other.id)).toBe(true)
    })

    it('raw SQL and direct database writes are refused too: the database is the authority', async () => {
      const { a } = await makeDebate({ hidden })
      let caught: unknown
      await db.article.update({ where: { id: a.id }, data: { status: 'PUBLISHED' } }).catch((e) => { caught = e })
      expect(isHiddenDebateViolation(caught)).toBe(true)
      caught = undefined
      await db.$executeRaw`UPDATE articles SET status = 'PUBLISHED' WHERE id = ${a.id}`.catch((e) => { caught = e })
      expect(isHiddenDebateViolation(caught)).toBe(true)
      caught = undefined
      await db.article.update({ where: { id: a.id }, data: { status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 1e6) } }).catch((e) => { caught = e })
      expect(isHiddenDebateViolation(caught)).toBe(true)
      expect(await isPublic(a.id)).toBe(false)
    })

    it('a rejected write leaves everything else on the row untouched (no partial update)', async () => {
      const { a } = await makeDebate({ hidden })
      const before = await fresh(a.id)
      await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { title: `${tag} renamed`, excerpt: 'changed', status: 'PUBLISHED', publicationIntent: true }), ctx(a.id))
      const after = await fresh(a.id)
      expect({ title: after.title, excerpt: after.excerpt, status: after.status }).toEqual({ title: before.title, excerpt: before.excerpt, status: before.status })
    })
  })

  it('the legitimate route still works: publishing or restoring the debate re-publishes its articles', async () => {
    const { debate, a, b } = await makeDebate({ articleStatus: 'PUBLISHED' })
    await db.article.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: 'PUBLISHED' } }) // visible debate: allowed
    await transitionDebate({ id: ids.admin }, debate.id, 'delete')
    expect(await isPublic(a.id)).toBe(false)
    await transitionDebate({ id: ids.admin }, debate.id, 'restore') // restored => unpublished, still not public
    expect(await isPublic(a.id)).toBe(false)
    await transitionDebate({ id: ids.admin }, debate.id, 'publish')
    expect(await isPublic(a.id)).toBe(true)
    expect(await isPublic(b.id)).toBe(true)
    // And an editor may once more save the articles of a visible debate.
    const res = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { excerpt: 'edited while visible' }), ctx(a.id))
    expect(res.status).toBe(200)
  })

  it('concurrency: hiding a debate while an article is being published always ends hidden', async () => {
    for (let i = 0; i < 25; i++) {
      const { debate, a } = await makeDebate({ articleStatus: 'ARCHIVED' }) // visible debate, article archived
      await Promise.allSettled([
        transitionDebate({ id: ids.admin }, debate.id, 'unpublish'),
        db.article.update({ where: { id: a.id }, data: { status: 'PUBLISHED' } }),
      ])
      const [d, row] = [await db.debate.findUniqueOrThrow({ where: { id: debate.id } }), await fresh(a.id)]
      expect(d.unpublishedAt, `iteration ${i}`).not.toBeNull()
      expect(row.status === 'PUBLISHED' && row.deletedAt === null, `iteration ${i}: published inside a hidden debate`).toBe(false)
    }
  })

  describe('read side, for data that predates the trigger (trigger switched off for the test)', () => {
    const toggle = async (on: boolean) => {
      const c = new Client({ connectionString: TEST_DB! })
      await c.connect()
      try { await c.query(`ALTER TABLE articles ${on ? 'ENABLE' : 'DISABLE'} TRIGGER articles_hidden_debate_guard`) } finally { await c.end() }
    }
    it('no public surface serves an already-exposed article of a hidden debate', async () => {
      await toggle(false)
      try {
        const { a } = await makeDebate({ hidden: 'unpublished' })
        await db.article.update({ where: { id: a.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }) // the corrupt state
        expect(await isPublic(a.id)).toBe(true) // it IS exposed at the data level...

        const slug = (await fresh(a.id)).slug
        // ...and every read path still refuses to serve it.
        expect(await db.article.count({ where: publishedArticleWhere({ id: a.id }) })).toBe(0)
        const hits = (await (await search(new NextRequest('http://localhost/api/search?q=quokka'))).json()) as { slug: string }[]
        expect(hits.some((h) => h.slug === slug)).toBe(false)
        expect(await (await feed()).text()).not.toContain(slug)
        expect(JSON.stringify(await sitemap())).not.toContain(slug)
        const newest = await (await latest()).json()
        expect(JSON.stringify(newest)).not.toContain(slug)
      } finally {
        await toggle(true)
      }
    })

    it('the migration heals that state: the exposed article is archived, a second run changes nothing', async () => {
      await toggle(false)
      let healed: number
      try {
        const { a, b } = await makeDebate({ hidden: 'deleted' })
        await db.article.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: 'PUBLISHED' } })
        const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261011_hidden_debate_article_guard.sql'), 'utf8')
        const c = new Client({ connectionString: TEST_DB! })
        await c.connect()
        try { await c.query(sql); const again = await c.query(sql); healed = again.rowCount ?? 0 } finally { await c.end() }
        expect((await fresh(a.id)).status).toBe('ARCHIVED')
        expect((await fresh(b.id)).status).toBe('ARCHIVED')
        expect(await db.debate.count({ where: { id: { not: undefined }, title: { startsWith: tag } } })).toBeGreaterThan(0)
      } finally {
        await toggle(true)
      }
      expect(healed).toBe(0)
    })
  })
})
