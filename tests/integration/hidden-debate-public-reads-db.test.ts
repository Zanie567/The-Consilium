/**
 * The public reads and writes that sit BESIDE the article lists (series navigation, trending topics, the archive's
 * topic filter, comments, reading progress, view counting) must apply the same visibility rule as everything else:
 * an article of an unpublished or deleted debate is invisible, whatever its own status says.
 *
 * Normally the database guard (articles_hidden_debate_guard) makes a PUBLISHED article of a hidden debate
 * impossible. These tests model data that PREDATES the guard (or a deployment where it is not applied yet) by
 * switching that one trigger off for the duration of each test, then prove every surface still refuses, while the
 * ordinary article next to it keeps working, and that publishing the debate brings the hidden one back.
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
    const { rowCount } = await client.query(`select 1 from pg_trigger where tgname = 'articles_hidden_debate_guard'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('articles_hidden_debate_guard is not installed in the isolated test database')
if (!isReady) console.warn('[hidden-debate-public-reads-db] skipped: the articles_hidden_debate_guard trigger is not installed here')
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
vi.mock('next/cache', () => ({ unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn, revalidateTag: () => {}, revalidatePath: () => {} }))

import { GET as getComments, POST as postComment } from '@/app/api/comments/route'
import { POST as upvote } from '@/app/api/comments/[commentId]/upvote/route'
import { GET as getProgress } from '@/app/api/reading-progress/route'
import { collectAnalytics } from '@/lib/analyticsCollector'
import { transitionDebate } from '@/lib/debateLifecycle'
import { SERIES_ARTICLES_ARGS, findPublicTopics, findTrendingTagRows } from '@/lib/publicArticleReads'

let db: PrismaClient
const tag = `pr-${Date.now()}`
const ids = { admin: '', reader: '', writer: '' }
const slugOf = (s: string) => `${tag}-${s}`
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

async function setGuard(on: boolean) {
  const c = new Client({ connectionString: TEST_DB! })
  await c.connect()
  try { await c.query(`ALTER TABLE articles ${on ? 'ENABLE' : 'DISABLE'} TRIGGER articles_hidden_debate_guard`) } finally { await c.end() }
}

/** An ordinary public article and the hidden debate's (legacy-corrupt: PUBLISHED) article, sharing a series, each with its own topic. */
async function fixture() {
  const series = await db.series.create({ data: { title: `${tag} series`, slug: slugOf(`series-${Math.random().toString(36).slice(2, 7)}`) } })
  const mk = (label: string, extra: object = {}) => db.article.create({
    data: {
      title: `${tag} ${label}`, slug: slugOf(`${label}-${Math.random().toString(36).slice(2, 7)}`), content: '{}', excerpt: label, authorId: ids.writer,
      status: 'PUBLISHED', publishedAt: new Date(), seriesId: series.id, seriesOrder: label === 'ordinary' ? 1 : 2, ...extra,
    },
  })
  const ordinary = await mk('ordinary')
  const other = await mk('other-side', { isDebate: true })
  await setGuard(false) // legacy state: the article is public although its debate is hidden
  const hidden = await mk('hidden', { isDebate: true })
  const debate = await db.debate.create({
    data: { title: `${tag} debate ${Math.random().toString(36).slice(2, 7)}`, forArticleId: hidden.id, againstArticleId: other.id, isActive: false, unpublishedAt: new Date() },
  })
  const topic = async (label: string, articleId: string) => {
    const t = await db.tag.create({ data: { name: `${tag} ${label} ${Math.random().toString(36).slice(2, 6)}`, slug: slugOf(`t-${label}-${Math.random().toString(36).slice(2, 7)}`) } })
    await db.articleTag.create({ data: { articleId, tagId: t.id } })
    return t
  }
  return { series, ordinary, hidden, other, debate, publicTopic: await topic('public', ordinary.id), hiddenTopic: await topic('hidden', hidden.id) }
}

suite('public reads and writes beside the article lists honour the hidden-debate rule (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'READER' | 'WRITER') => db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    ids.admin = (await mk('admin', 'ADMIN')).id
    ids.reader = (await mk('reader', 'READER')).id
    ids.writer = (await mk('writer', 'WRITER')).id
  })
  beforeEach(async () => { await setGuard(true); state.session = { id: ids.reader } })
  afterAll(async () => {
    await setGuard(true)
    const debates = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: debates.map((d) => d.id) } }, { performedBy: { in: Object.values(ids) } }] } })
    await db.comment.deleteMany({ where: { article: { slug: { startsWith: tag } } } })
    await db.articleTag.deleteMany({ where: { article: { slug: { startsWith: tag } } } })
    await db.tag.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } })
    await db.readingProgress.deleteMany({ where: { userId: { in: Object.values(ids) } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.series.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('series navigation lists the ordinary article but never the hidden debate article; publishing the debate brings it back', async () => {
    const f = await fixture()
    try {
      const listed = async () => (await db.series.findUniqueOrThrow({ where: { id: f.series.id }, include: { articles: SERIES_ARTICLES_ARGS } })).articles.map((a) => a.id)
      expect(await listed()).toEqual([f.ordinary.id])
      await setGuard(true)
      await transitionDebate({ id: ids.admin }, f.debate.id, 'publish') // legitimate flow: legacy PUBLISHED article is untouched, other side restored only if marked
      expect(await listed()).toContain(f.hidden.id)
    } finally { await setGuard(true) }
  })

  it('trending topics and the archive topic filter never include a topic used only by a hidden debate article', async () => {
    const f = await fixture()
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600_000)
      const trending = (await findTrendingTagRows(db as never, since)).map((r) => r.tagId)
      expect(trending).toContain(f.publicTopic.id)
      expect(trending).not.toContain(f.hiddenTopic.id)
      const topics = (await findPublicTopics(db as never)).map((t) => t.id)
      expect(topics).toContain(f.publicTopic.id)
      expect(topics).not.toContain(f.hiddenTopic.id)

      await setGuard(true)
      await db.debate.update({ where: { id: f.debate.id }, data: { unpublishedAt: null } }) // the debate is public again
      expect((await findPublicTopics(db as never)).map((t) => t.id)).toContain(f.hiddenTopic.id)
      expect((await findTrendingTagRows(db as never, since)).map((r) => r.tagId)).toContain(f.hiddenTopic.id)
    } finally { await setGuard(true) }
  })

  it('comments: not served, not accepted and not upvotable on a hidden debate article, and unchanged on an ordinary one', async () => {
    const f = await fixture()
    try {
      const seed = (articleId: string) => db.comment.create({ data: { articleId, userId: ids.writer, body: `${tag} an earlier comment` } })
      const onOrdinary = await seed(f.ordinary.id)
      const onHidden = await seed(f.hidden.id)

      const read = async (articleId: string) => (await (await getComments(new Request(`http://localhost/api/comments?articleId=${articleId}`))).json()) as { comments: unknown[]; total: number }
      expect((await read(f.ordinary.id)).total).toBe(1)
      expect(await read(f.hidden.id)).toEqual({ comments: [], total: 0 })

      const create = (articleId: string) => postComment(json('/api/comments', 'POST', { articleId, body: `${tag} a considered point` }))
      expect((await create(f.ordinary.id)).status).toBe(201)
      expect((await create(f.hidden.id)).status).toBe(404)
      expect(await db.comment.count({ where: { articleId: f.hidden.id } })).toBe(1) // only the pre-existing one

      const vote = (commentId: string) => upvote(json(`/api/comments/${commentId}/upvote`, 'POST'), { params: Promise.resolve({ commentId }) })
      expect((await vote(onOrdinary.id)).status).toBe(200)
      expect((await vote(onHidden.id)).status).toBe(404)
      expect((await db.comment.findUniqueOrThrow({ where: { id: onHidden.id } })).upvotes).toBe(0)
    } finally { await setGuard(true) }
  })

  it('comments are also refused on a trashed article (a previous gap in the same check)', async () => {
    const f = await fixture()
    try {
      await db.article.update({ where: { id: f.ordinary.id }, data: { deletedAt: new Date() } })
      expect((await postComment(json('/api/comments', 'POST', { articleId: f.ordinary.id, body: `${tag} too late` }))).status).toBe(404)
    } finally { await setGuard(true) }
  })

  it('"continue reading" never offers a hidden debate article, and view counting ignores it', async () => {
    const f = await fixture()
    try {
      for (const articleId of [f.ordinary.id, f.hidden.id]) await db.readingProgress.create({ data: { userId: ids.reader, articleId, progress: 40 } })
      const res = await getProgress()
      const offered = ((await res.json()) as { articleId?: string; article?: { id: string } }[]).map((r) => r.article?.id ?? r.articleId)
      expect(offered).toContain(f.ordinary.id)
      expect(offered).not.toContain(f.hidden.id)

      await collectAnalytics({ sessionId: `${tag}-s1`, articleId: f.ordinary.id })
      await collectAnalytics({ sessionId: `${tag}-s2`, articleId: f.hidden.id })
      expect((await db.article.findUniqueOrThrow({ where: { id: f.ordinary.id } })).viewCount).toBe(1)
      expect((await db.article.findUniqueOrThrow({ where: { id: f.hidden.id } })).viewCount).toBe(0)
      expect(await db.articleView.count({ where: { articleId: f.hidden.id } })).toBe(0)
    } finally { await setGuard(true) }
  })
})
