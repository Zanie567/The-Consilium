/**
 * feed.xml and sitemap.xml against a REAL Postgres, driven through the REAL mutation routes, with a tagged data cache
 * that is warmed before each change. Every assertion is on the XML that is served next, never on whether an invalidation
 * function was called: the removed article's title and URL must be gone, and restoring it must bring it back.
 *
 * The cache here is a faithful stand-in (tests/helpers/fakeNextCache.ts); the real framework is covered by the browser
 * test against a production build (tests/e2e/wf-feed-invalidation.spec.ts).
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
  const c = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try { await c.connect(); return (await c.query(`select 1 from pg_trigger where tgname = 'articles_hidden_debate_guard'`)).rowCount === 1 } catch { return false } finally { await c.end().catch(() => {}) }
}
const isReady = await ready()
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('articles_hidden_debate_guard is not installed in the isolated test database')
if (!isReady) console.warn('[public-feed-visibility-db] skipped: the guard trigger is not installed here')
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

import { GET as feed } from '@/app/feed.xml/route'
import sitemap from '@/app/sitemap'
import { PUT as saveArticle, DELETE as trashArticle } from '@/app/api/articles/[id]/route'
import { PATCH as restoreFromTrash } from '@/app/api/editorial/trash/[id]/route'
import { PATCH as review } from '@/app/api/editorial/articles/[id]/review/route'
import { POST as lifecycle } from '@/app/api/editorial/debates/[debateId]/lifecycle/route'
import { DELETE as deleteUser } from '@/app/api/admin/users/[userId]/route'
import { FEED_DATA_TTL_SECONDS, FRESH_XML_CACHE_CONTROL } from '@/lib/publicFeeds'

let db: PrismaClient
const tag = `pf-${Date.now()}`
const ids = { admin: '', editor: '', writer: '' }
let n = 0
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const dctx = (debateId: string) => ({ params: Promise.resolve({ debateId }) })
const as = (id: string) => { state.session = { id } }
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

async function article(label: string, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED', authorId = ids.writer) {
  const k = ++n
  return db.article.create({ data: { title: `${tag} ${label} ${k} narwhal`, slug: `${tag}-${label}-${k}`, content: '{}', excerpt: 'narwhal', authorId, status, publishedAt: status === 'PUBLISHED' ? new Date() : null } })
}
async function debate(label: string) {
  const [a, b] = [await article(`${label}-for`), await article(`${label}-against`)]
  await db.article.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { isDebate: true } })
  const d = await db.debate.create({ data: { title: `${tag} ${label} debate`, forArticleId: a.id, againstArticleId: b.id, isActive: false } })
  return { d, a, b }
}
const feedXml = async () => { const r = await feed(); expect(r.status).toBe(200); return r.text() }
const sitemapUrls = async () => (await sitemap()).map((e) => e.url)
/** Both listings, as served right now. */
async function served(a: { slug: string; title: string }) {
  const xml = await feedXml()
  return { feedLink: xml.includes(`/articles/${a.slug}`), feedTitle: xml.includes(a.title), sitemap: (await sitemapUrls()).some((u) => u.endsWith(`/articles/${a.slug}`)) }
}
const IN = { feedLink: true, feedTitle: true, sitemap: true }, OUT = { feedLink: false, feedTitle: false, sitemap: false }
const act = async (debateId: string, action: string, extra: Record<string, unknown> = {}) => {
  as(ids.admin); const res = await lifecycle(json(`/api/editorial/debates/${debateId}/lifecycle`, 'POST', { action, ...extra }), dctx(debateId))
  return { status: res.status, body: await res.json() }
}

suite('feed.xml and sitemap.xml follow every visibility change (real database, warmed cache)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'EDITOR' | 'WRITER') => db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date(), slug: `${tag}-${label}` } })
    ids.admin = (await mk('admin', 'ADMIN')).id; ids.editor = (await mk('editor', 'EDITOR')).id; ids.writer = (await mk('writer', 'WRITER')).id
  })
  beforeEach(() => { cache.reset(); as(ids.editor) })
  afterAll(async () => {
    const debates = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: debates.map((d) => d.id) } }, { performedBy: { in: Object.values(ids) } }] } })
    await db.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.tag.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('serves XML that no browser or CDN may keep, with the content-type intact', async () => {
    const r = await feed()
    expect(r.headers.get('cache-control')).toBe(FRESH_XML_CACHE_CONTROL)
    expect(r.headers.get('content-type')).toMatch(/application\/xml/)
  })

  it('ordinary lifecycle: publish, trash, restore, archive, republish, unpublish: each change is in the next XML served', async () => {
    const a = await article('ordinary')
    expect(await served(a)).toEqual(IN) // warms both caches
    expect(await served(a)).toEqual(IN) // served from the warm cache
    expect(cache.stats.hits).toBeGreaterThan(0)

    as(ids.editor)
    expect((await trashArticle(json(`/api/articles/${a.id}`, 'DELETE'), ctx(a.id))).status).toBe(200)
    expect(await served(a)).toEqual(OUT) // trashed

    as(ids.admin)
    expect((await restoreFromTrash(json(`/api/editorial/trash/${a.id}`, 'PATCH'), ctx(a.id))).status).toBe(200)
    expect(await served(a)).toEqual(IN) // restored

    as(ids.editor)
    expect((await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'ARCHIVED', publicationIntent: true }), ctx(a.id))).status).toBe(200)
    expect(await served(a)).toEqual(OUT) // archived
    expect((await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'PUBLISHED', publicationIntent: true }), ctx(a.id))).status).toBe(200)
    expect(await served(a)).toEqual(IN) // republished

    expect((await review(json(`/api/editorial/articles/${a.id}/review`, 'PATCH', { action: 'unpublish' }), ctx(a.id))).status).toBe(200)
    expect(await served(a)).toEqual(OUT) // taken down by review
  })

  it('debate lifecycle: unpublish, publish, delete, restore, publish, delete, purge: both articles follow in both listings', async () => {
    const { d, a, b } = await debate('life')
    const both = async () => [await served(a), await served(b)]
    expect(await both()).toEqual([IN, IN]); expect(await both()).toEqual([IN, IN]) // warm

    expect((await act(d.id, 'unpublish')).status).toBe(200); expect(await both()).toEqual([OUT, OUT])
    expect((await act(d.id, 'publish')).status).toBe(200); expect(await both()).toEqual([IN, IN])
    expect((await act(d.id, 'delete')).status).toBe(200); expect(await both()).toEqual([OUT, OUT])
    expect((await act(d.id, 'restore')).status).toBe(200); expect(await both()).toEqual([OUT, OUT]) // restore never publishes
    expect((await act(d.id, 'publish')).status).toBe(200); expect(await both()).toEqual([IN, IN])
    expect((await act(d.id, 'delete')).status).toBe(200)
    expect((await act(d.id, 'purge', { confirmTitle: d.title })).status).toBe(200); expect(await both()).toEqual([OUT, OUT])
  })

  it('a refused or failed mutation expires nothing and leaves the served XML exactly as it was', async () => {
    const { d, a } = await debate('refused')
    await act(d.id, 'unpublish')
    expect(await served(a)).toEqual(OUT) // warm, hidden
    const before = { inv: cache.stats.invalidations.length, hits: cache.stats.hits }
    as(ids.editor)
    const attack = await saveArticle(json(`/api/articles/${a.id}`, 'PUT', { status: 'PUBLISHED', publicationIntent: true }), ctx(a.id))
    expect(attack.status).toBe(409)
    expect(cache.stats.invalidations.length).toBe(before.inv) // nothing was committed, so nothing was expired
    expect(await served(a)).toEqual(OUT)
    // a stale lifecycle request is also refused without invalidating
    const stale = await act(d.id, 'publish', { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })
    expect(stale.status).toBe(409)
    expect(cache.stats.invalidations.length).toBe(before.inv)
    expect(await served(a)).toEqual(OUT)
  })

  it('if invalidation fails the change still commits, the administrator is told, and staleness ends by itself within the TTL', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { d, a } = await debate('failinv')
    expect(await served(a)).toEqual(IN)
    cache.failInvalidations(true)
    const res = await act(d.id, 'unpublish')
    expect(res.status).toBe(200)
    expect(res.body.publicCacheRefreshed).toBe(false) // surfaced, not swallowed
    expect((await db.debate.findUniqueOrThrow({ where: { id: d.id } })).unpublishedAt).not.toBeNull()
    expect(await served(a)).toEqual(IN) // stale: the cache could not be expired...
    const t = Date.now(); cache.clock.now = () => t + (FEED_DATA_TTL_SECONDS + 1) * 1000
    expect(await served(a)).toEqual(OUT) // ...but never for longer than the TTL
    cache.clock.now = () => Date.now(); cache.failInvalidations(false); log.mockRestore()
    expect((await act(d.id, 'publish')).body.publicCacheRefreshed).toBe(true)
  })

  it('articles of a hidden debate are excluded even when their own status is inconsistent (data that predates the guard)', async () => {
    const c = new Client({ connectionString: TEST_DB! }); await c.connect()
    await c.query('ALTER TABLE articles DISABLE TRIGGER articles_hidden_debate_guard')
    try {
      const { d, a } = await debate('legacy')
      await db.debate.update({ where: { id: d.id }, data: { deletedAt: new Date(), unpublishedAt: new Date() } })
      expect((await db.article.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('PUBLISHED') // inconsistent on purpose
      cache.reset()
      expect(await served(a)).toEqual(OUT)
    } finally { await c.query('ALTER TABLE articles ENABLE TRIGGER articles_hidden_debate_guard'); await c.end() }
  })

  it('deleting an author removes their articles from both listings straight away', async () => {
    const author = await db.user.create({ data: { email: `${tag}-doomed@ed.ac.uk`, name: 'Doomed', role: 'WRITER', emailVerified: new Date(), slug: `${tag}-doomed` } })
    const a = await article('author-gone', 'PUBLISHED', author.id)
    expect(await served(a)).toEqual(IN)
    as(ids.admin)
    const res = await deleteUser(json(`/api/admin/users/${author.id}`, 'DELETE', { confirmEmail: author.email }), { params: Promise.resolve({ userId: author.id }) })
    expect(res.status).toBe(200)
    expect(await served(a)).toEqual(OUT)
    expect((await sitemapUrls()).some((u) => u.includes(`${tag}-doomed`))).toBe(false) // and their author page
  })

  it('topics used only by hidden articles are not advertised in the sitemap; topics with a public article are', async () => {
    const topicSecret = await db.tag.create({ data: { name: `${tag} secret topic`, slug: `${tag}-secret-topic` } })
    const topicOpen = await db.tag.create({ data: { name: `${tag} open topic`, slug: `${tag}-open-topic` } })
    const hidden = await article('tagged-hidden', 'DRAFT'); const open = await article('tagged-open')
    await db.articleTag.create({ data: { articleId: hidden.id, tagId: topicSecret.id } })
    await db.articleTag.create({ data: { articleId: open.id, tagId: topicOpen.id } })
    const urls = await sitemapUrls()
    expect(urls.some((u) => u.endsWith(`/tag/${topicSecret.slug}`))).toBe(false)
    expect(urls.some((u) => u.endsWith(`/tag/${topicOpen.slug}`))).toBe(true)
  })

  it('a database failure is neither cached nor reported as an empty listing for the feed', async () => {
    const bad = new Proxy(db, { get: (t, k, r) => (k === 'article' ? { findMany: async () => { throw new Error('db down') } } : Reflect.get(t, k, r)) })
    state.prisma = bad
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { expect((await feed()).status).toBe(500) } finally { state.prisma = db; log.mockRestore() }
    const a = await article('after-outage')
    expect(await served(a)).toEqual(IN) // the failure was not cached
  })
})
