/**
 * Post-publication corrections against real PostgreSQL: the real route handlers, the real service, the real
 * migration (20261017120000: constraints, partial unique index, protection trigger). Only the session, email
 * and the Next cache are stand-ins. Synthetic fixtures only; everything created is removed afterwards.
 *
 * What must hold:
 *   - a correction amends the article and publishes its notice atomically, or changes nothing;
 *   - a stale tab, a second editor, a double click or a replay never overwrites work or duplicates a notice;
 *   - only approval roles publish; editors prepare within their categories; writers and readers cannot act;
 *   - only PUBLISHED, non-trashed articles can be corrected; status, dates, URL and counters are untouched;
 *   - published records are permanent (even raw SQL is refused), amendments supersede instead;
 *   - the general editor cannot silently change a live article's text, and the retired paths are closed;
 *   - legacy single-note corrections migrate without an invented date;
 *   - notification or cache failures after the commit are warnings, never a failed correction.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
    const { rowCount } = await client.query(`select 1 from pg_trigger where tgname = 'article_corrections_protect'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('article_corrections_protect is not installed in the isolated test database')
if (!isReady) console.warn('[corrections-db] skipped: migration 20261017120000 is not applied to this database')
const suite = isReady ? describe : describe.skip

const { state, cache, revalidatePath, sendEmail, awardPublishAchievements } = await vi.hoisted(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  const { createFakeNextCache } = await import('../helpers/fakeNextCache')
  const { vi: hoistedVi } = await import('vitest')
  return {
    state: { prisma: undefined as unknown, session: null as null | { id: string } },
    cache: createFakeNextCache(),
    revalidatePath: hoistedVi.fn(),
    sendEmail: hoistedVi.fn(async () => true),
    awardPublishAchievements: hoistedVi.fn(),
  }
})
vi.mock('next/cache', () => ({ unstable_cache: cache.unstable_cache, revalidateTag: cache.revalidateTag, revalidatePath }))
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }) }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
vi.mock('@/lib/email', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/email')>()), sendEmail }))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements }))

import { GET as listCorrections, POST as createCorrection } from '@/app/api/editorial/articles/[id]/corrections/route'
import { PATCH as changeCorrection } from '@/app/api/editorial/articles/[id]/corrections/[correctionId]/route'
import { POST as previewCorrection } from '@/app/api/editorial/articles/[id]/corrections/preview/route'
import { PUT as saveArticle, GET as readArticle } from '@/app/api/articles/[id]/route'
import { PATCH as reviewArticle } from '@/app/api/editorial/articles/[id]/review/route'
import { articleVersion } from '@/lib/articleVersion'
import { loadPublicCorrections } from '@/lib/corrections/public'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { composeLegacyMirror } from '@/lib/corrections/format'

let db: PrismaClient
const tag = `corr-${Date.now()}`
const ids = { admin: '', admin2: '', editor: '', scoped: '', writer: '', reader: '', catA: '', catB: '' }
let n = 0

const doc = (...paragraphs: string[]) => JSON.stringify({
  type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
})
const ORIGINAL = doc('Unemployment rose to 5.2% in September.', 'Wages grew by 3%.')
const CORRECTED = doc('Unemployment rose to 4.8% in September.', 'Wages grew by 3%.')
const PUBLISHED_AT = new Date('2026-09-01T08:00:00.000Z')

const as = (user: keyof typeof ids | null) => { state.session = user ? { id: ids[user] } : null }
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ctx2 = (id: string, correctionId: string) => ({ params: Promise.resolve({ id, correctionId }) })

async function makeArticle(over: Record<string, unknown> = {}) {
  const k = ++n
  return db.article.create({
    data: {
      title: `${tag} ${k} Labour market`, slug: `${tag}-${k}`, content: ORIGINAL, excerpt: 'Standfirst',
      authorId: ids.writer, categoryId: ids.catB, status: 'PUBLISHED', publishedAt: PUBLISHED_AT, viewCount: 42,
      ...over,
    },
  })
}
async function versionOf(id: string) {
  const a = await db.article.findUniqueOrThrow({ where: { id }, include: { tags: { include: { tag: true } } } })
  return articleVersion(a, a.tags.map((t) => t.tag.name))
}
async function draft(articleId: string, over: Record<string, unknown> = {}) {
  const a = await db.article.findUniqueOrThrow({ where: { id: articleId } })
  return {
    type: 'CORRECTION',
    originalText: 'Unemployment rose to 5.2%',
    correctedText: 'The correct figure was 4.8%',
    publicNote: 'An earlier version of this article stated that unemployment had risen to 5.2%. The correct figure was 4.8%. The article has been amended.',
    internalNote: 'Internal: ONS table 3, flagged by a reader.',
    title: a.title, excerpt: a.excerpt, content: CORRECTED,
    baseVersion: await versionOf(articleId),
    requestKey: randomUUID(),
    ...over,
  }
}
async function create(articleId: string, body: Record<string, unknown>) {
  const res = await createCorrection(req(`/api/editorial/articles/${articleId}/corrections`, 'POST', body), ctx(articleId))
  return { status: res.status, body: await res.json() }
}
async function patch(articleId: string, correctionId: string, body: Record<string, unknown>) {
  const res = await changeCorrection(req(`/api/editorial/articles/${articleId}/corrections/${correctionId}`, 'PATCH', body), ctx2(articleId, correctionId))
  return { status: res.status, body: await res.json() }
}
const publishNow = async (articleId: string, over: Record<string, unknown> = {}) =>
  create(articleId, { ...(await draft(articleId, over)), publish: true, confirm: true })
const corrections = (articleId: string) => db.articleCorrection.findMany({ where: { articleId }, orderBy: { createdAt: 'asc' } })

async function withConnection<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_DB })
  await client.connect()
  try { return await fn(client) } finally { await client.end().catch(() => {}) }
}

suite('post-publication corrections (real PostgreSQL)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'EDITOR' | 'WRITER' | 'READER') =>
      db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    ids.admin = (await mk('admin', 'ADMIN')).id
    ids.admin2 = (await mk('admin2', 'ADMIN')).id
    ids.editor = (await mk('editor', 'EDITOR')).id
    ids.scoped = (await mk('scoped', 'EDITOR')).id
    ids.writer = (await mk('writer', 'WRITER')).id
    ids.reader = (await mk('reader', 'READER')).id
    ids.catA = (await db.category.create({ data: { name: `${tag} A`, slug: `${tag}-a` } })).id
    ids.catB = (await db.category.create({ data: { name: `${tag} B`, slug: `${tag}-b` } })).id
    await db.categoryEditor.create({ data: { userId: ids.scoped, categoryId: ids.catA } })
  })
  beforeEach(() => {
    cache.reset()
    revalidatePath.mockClear()
    sendEmail.mockClear()
    awardPublishAchievements.mockClear()
    as('admin')
  })
  afterAll(async () => {
    const users = Object.values(ids)
    await db.notification.deleteMany({ where: { userId: { in: users } } })
    await db.auditLog.deleteMany({ where: { performedBy: { in: users } } })
    await db.bookmark.deleteMany({ where: { userId: { in: users } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } }) // cascades to article_corrections
    await db.categoryEditor.deleteMany({ where: { userId: { in: users } } })
    await db.category.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  // ── Publishing ─────────────────────────────────────────────────────────────────────────────────

  it('publishes a factual correction: text amended, notice recorded, audit written, nothing else on the article touched', async () => {
    const article = await makeArticle({ isPinned: true })
    await db.bookmark.create({ data: { userId: ids.reader, articleId: article.id } })
    const before = Date.now()
    const { status, body } = await publishNow(article.id)
    expect(status).toBe(201)
    expect(body).toMatchObject({ published: true, replayed: false, warnings: [] })

    const row = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(row.content).toBe(CORRECTED)
    // Untouched: status, original publication date, URL, schedule, flags, counters, author, category.
    expect(row).toMatchObject({
      status: 'PUBLISHED', publishedAt: PUBLISHED_AT, slug: article.slug, scheduledAt: null, isFeatured: false,
      isPinned: true, viewCount: 42, authorId: ids.writer, categoryId: ids.catB,
    })
    // Rollback-compatibility mirror for an older build: every published notice, labelled and dated.
    expect(row).toMatchObject({ corrected: true, correctionNote: composeLegacyMirror([body.correction].map((c) => ({ ...c, publishedAt: new Date(c.publishedAt) }))) })
    expect(row.correctionNote).toMatch(/^Correction \(\d{1,2} \w+ \d{4}\): An earlier version/)
    expect(await db.bookmark.count({ where: { articleId: article.id } })).toBe(1)

    const [c] = await corrections(article.id)
    expect(c).toMatchObject({
      status: 'PUBLISHED', type: 'CORRECTION', createdById: ids.admin, approvedById: ids.admin,
      approvedByName: `admin ${tag}`, previous: { title: article.title, excerpt: 'Standfirst', content: ORIGINAL },
      proposed: { content: CORRECTED },
    })
    // Server clock, not the client.
    expect(c.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(c.publishedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)

    const audit = await db.auditLog.findMany({ where: { targetId: article.id }, orderBy: { createdAt: 'asc' } })
    expect(audit.map((a) => a.action)).toEqual(['correction.prepared', 'correction.published'])

    // The author is told; no "published" notification, email, achievement or newsletter-like side effect.
    const notes = await db.notification.findMany({ where: { articleId: article.id } })
    expect(notes.map((x) => [x.userId, x.type])).toEqual([[ids.writer, 'correction_published']])
    expect(sendEmail).not.toHaveBeenCalled()
    expect(awardPublishAchievements).not.toHaveBeenCalled()

    // Public caches: lists, feed and sitemap share the tag; the article path too.
    expect(cache.stats.invalidations).toContain('articles')
    expect(revalidatePath).toHaveBeenCalledWith(`/articles/${article.slug}`)
  })

  it('keeps several successive corrections in chronological order with their own dates; public read exposes public fields only', async () => {
    const article = await makeArticle()
    expect((await publishNow(article.id)).status).toBe(201)
    await new Promise((r) => setTimeout(r, 15))
    const third = doc('Unemployment rose to 4.8% in September.', 'Wages grew by 2.9%.')
    expect((await publishNow(article.id, {
      originalText: 'Wages grew by 3%', correctedText: 'Wages grew by 2.9%', content: third,
      publicNote: 'An earlier version of this article said wages grew by 3%. They grew by 2.9%.',
    })).status).toBe(201)

    const rows = await corrections(article.id)
    expect(rows).toHaveLength(2)
    expect(rows[0].publishedAt!.getTime()).toBeLessThan(rows[1].publishedAt!.getTime())
    expect(rows[1].previous).toMatchObject({ content: CORRECTED })

    const current = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const pub = await loadPublicCorrections(db as never, current)
    expect(pub.map((p) => p.id)).toEqual(rows.map((r) => r.id))
    for (const p of pub) {
      expect(Object.keys(p).sort()).toEqual(['id', 'legacy', 'publicNote', 'publishedAt', 'supersedesId', 'type'])
    }
    expect(JSON.stringify(pub)).not.toContain('Internal:')
    expect(JSON.stringify(pub)).not.toContain(ids.admin)
  })

  it('a correction must amend the text; a clarification or update need not, and is not mirrored as a correction', async () => {
    const article = await makeArticle()
    const same = await publishNow(article.id, { content: ORIGINAL })
    expect(same.status).toBe(400)
    expect(same.body.code).toBe('NO_TEXT_CHANGE')
    expect(await corrections(article.id)).toHaveLength(0)

    const clarification = await publishNow(article.id, {
      type: 'CLARIFICATION', content: ORIGINAL, correctedText: '',
      publicNote: 'This article has been clarified to make clear that the figure is seasonally adjusted.',
    })
    expect(clarification.status).toBe(201)
    const row = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(row.content).toBe(ORIGINAL)
    // The legacy mirror carries the clarification with its true label, so a rollback would not lose it.
    expect(row.corrected).toBe(true)
    expect(row.correctionNote).toMatch(/^Clarification \(/)
    expect((await corrections(article.id))[0]).toMatchObject({ type: 'CLARIFICATION', status: 'PUBLISHED' })

    const update = await publishNow(article.id, {
      type: 'UPDATE', content: ORIGINAL, originalText: '', correctedText: '',
      publicNote: 'This article was updated on publication of the October labour market figures.',
    })
    expect(update.status).toBe(201)
    expect((await corrections(article.id)).map((c) => c.type)).toEqual(['CLARIFICATION', 'UPDATE'])
  })

  it('requires explicit confirmation to publish immediately', async () => {
    const article = await makeArticle()
    const res = await create(article.id, { ...(await draft(article.id)), publish: true })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PUBLICATION_CONFIRMATION_REQUIRED')
    expect(await corrections(article.id)).toHaveLength(0)
  })

  // ── Approval workflow and permissions ──────────────────────────────────────────────────────────

  it('an editor prepares, an administrator approves exactly what was prepared; editors cannot publish', async () => {
    const article = await makeArticle()
    as('editor')
    const direct = await publishNow(article.id)
    expect(direct.status).toBe(403)
    expect(await corrections(article.id)).toHaveLength(0)

    const submitted = await create(article.id, await draft(article.id))
    expect(submitted.status).toBe(201)
    expect(submitted.body).toMatchObject({ published: false })
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(ORIGINAL) // nothing public yet
    expect(cache.stats.invalidations).toEqual([])
    // Approvers are told a correction is waiting.
    expect(await db.notification.count({ where: { articleId: article.id, type: 'correction_submitted', userId: ids.admin } })).toBe(1)

    const pending = submitted.body.correction
    const editorPublish = await patch(article.id, pending.id, { action: 'publish', confirm: true, expectedUpdatedAt: pending.updatedAt })
    expect(editorPublish.status).toBe(403)

    as('admin')
    const approved = await patch(article.id, pending.id, { action: 'publish', confirm: true, expectedUpdatedAt: pending.updatedAt })
    expect(approved.status).toBe(200)
    const [c] = await corrections(article.id)
    expect(c).toMatchObject({ status: 'PUBLISHED', createdById: ids.editor, approvedById: ids.admin })
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(CORRECTED)
    // Both the author and the preparing editor are told.
    const told = await db.notification.findMany({ where: { articleId: article.id, type: 'correction_published' }, select: { userId: true } })
    expect(told.map((t) => t.userId).sort()).toEqual([ids.editor, ids.writer].sort())

    // Approving twice (double click, second tab) is refused, never a second notice.
    const again = await patch(article.id, pending.id, { action: 'publish', confirm: true, expectedUpdatedAt: pending.updatedAt })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('CORRECTION_NOT_PENDING')
    expect(await corrections(article.id)).toHaveLength(1)
  })

  it('only one correction can await approval per article; withdrawing frees the slot and keeps the record', async () => {
    const article = await makeArticle()
    as('editor')
    const first = await create(article.id, await draft(article.id))
    expect(first.status).toBe(201)
    as('admin2')
    const second = await create(article.id, await draft(article.id))
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('PENDING_CORRECTION_EXISTS')
    // An administrator cannot publish around a waiting correction either.
    expect((await publishNow(article.id)).body.code).toBe('PENDING_CORRECTION_EXISTS')

    as('scoped') // not the preparer, not an approver (and out of scope)
    expect((await patch(article.id, first.body.correction.id, { action: 'withdraw', reason: 'x', expectedUpdatedAt: first.body.correction.updatedAt })).status).toBe(403)
    as('editor')
    const withdrawn = await patch(article.id, first.body.correction.id, { action: 'withdraw', reason: 'Duplicate of the reader report handled by email.', expectedUpdatedAt: first.body.correction.updatedAt })
    expect(withdrawn.status).toBe(200)
    expect(withdrawn.body.correction).toMatchObject({ status: 'WITHDRAWN', withdrawnById: ids.editor })
    expect((await create(article.id, await draft(article.id))).status).toBe(201)
    expect((await corrections(article.id)).map((c) => c.status)).toEqual(['WITHDRAWN', 'PENDING'])
  })

  it('refuses writers, readers, signed-out users and editors outside their categories', async () => {
    const article = await makeArticle() // category B
    for (const user of ['writer', 'reader'] as const) {
      as(user)
      expect((await create(article.id, await draft(article.id))).status).toBe(403)
      expect((await listCorrections(req('/x', 'GET'), ctx(article.id))).status).toBe(403)
    }
    as(null)
    expect((await create(article.id, await draft(article.id))).status).toBe(401)
    as('scoped') // assigned to category A only
    const scoped = await create(article.id, await draft(article.id))
    expect(scoped.status).toBe(403)
    expect(scoped.body.code).toBe('CATEGORY_SCOPE_DENIED')
    expect((await listCorrections(req('/x', 'GET'), ctx(article.id))).status).toBe(403)
    expect((await previewCorrection(req('/x', 'POST', { content: ORIGINAL }), ctx(article.id))).status).toBe(403)
    expect(await corrections(article.id)).toHaveLength(0)

    const inScope = await makeArticle({ categoryId: ids.catA })
    expect((await create(inScope.id, await draft(inScope.id))).status).toBe(201)
  })

  it.each([
    ['DRAFT', {}],
    ['PENDING_REVIEW', {}],
    ['SCHEDULED', { scheduledAt: new Date(Date.now() + 86_400_000), publishedAt: null }],
    ['ARCHIVED', {}],
    ['REJECTED', {}],
  ] as const)('refuses to correct a %s article', async (status, extra) => {
    const article = await makeArticle({ status, ...extra })
    const res = await publishNow(article.id)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ARTICLE_NOT_PUBLISHED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(ORIGINAL)
  })

  it('refuses a trashed article, and an approval after the article was unpublished', async () => {
    const trashed = await makeArticle({ deletedAt: new Date() })
    expect((await publishNow(trashed.id)).status).toBe(404)

    const article = await makeArticle()
    as('editor')
    const pending = (await create(article.id, await draft(article.id))).body.correction
    await db.article.update({ where: { id: article.id }, data: { status: 'DRAFT', publishedAt: null } })
    as('admin')
    const res = await patch(article.id, pending.id, { action: 'publish', confirm: true, expectedUpdatedAt: pending.updatedAt })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ARTICLE_NOT_PUBLISHED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).status).toBe('DRAFT')
  })

  // ── Concurrency, staleness, idempotency ────────────────────────────────────────────────────────

  it('a stale tab is refused: the article changed after the form was opened', async () => {
    const article = await makeArticle()
    const stale = await draft(article.id)
    await db.article.update({ where: { id: article.id }, data: { content: doc('Someone else edited this.') } })
    const res = await create(article.id, { ...stale, publish: true, confirm: true })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ARTICLE_CHANGED')
    expect(await corrections(article.id)).toHaveLength(0)
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(doc('Someone else edited this.'))
  })

  it('a pending correction cannot be approved over a later change to the article, nor after it was revised', async () => {
    const article = await makeArticle()
    as('editor')
    const pending = (await create(article.id, await draft(article.id))).body.correction
    const revised = await patch(article.id, pending.id, { action: 'revise', ...(await draft(article.id, { publicNote: 'Revised note: the figure was 4.8%.' })), expectedUpdatedAt: pending.updatedAt })
    expect(revised.status).toBe(200)

    as('admin')
    // Approving the version the administrator opened before the revision is refused.
    const old = await patch(article.id, pending.id, { action: 'publish', confirm: true, expectedUpdatedAt: pending.updatedAt })
    expect(old.status).toBe(409)
    expect(old.body.code).toBe('CORRECTION_CHANGED')

    // A copy edit lands after preparation: the prepared amendment no longer matches.
    await db.article.update({ where: { id: article.id }, data: { title: `${article.title} (copy edited)` } })
    const res = await patch(article.id, pending.id, { action: 'publish', confirm: true, expectedUpdatedAt: revised.body.correction.updatedAt })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ARTICLE_CHANGED')
    const row = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(row).toMatchObject({ content: ORIGINAL, title: `${article.title} (copy edited)` })
    expect((await corrections(article.id))[0].status).toBe('PENDING')
  })

  it('two administrators correcting the same article at once: exactly one wins, no lost update, one notice', async () => {
    for (let round = 0; round < 3; round++) {
      const article = await makeArticle()
      const a = await draft(article.id, { content: doc('Version A.'), originalText: 'x', correctedText: 'A' })
      const b = await draft(article.id, { content: doc('Version B.'), originalText: 'x', correctedText: 'B' })
      const results = await Promise.all([
        (async () => { state.session = { id: ids.admin }; return create(article.id, { ...a, publish: true, confirm: true }) })(),
        (async () => { state.session = { id: ids.admin2 }; return create(article.id, { ...b, publish: true, confirm: true }) })(),
      ])
      const statuses = results.map((r) => r.status).sort()
      expect(statuses).toEqual([201, 409])
      const loser = results.find((r) => r.status === 409)!
      expect(['ARTICLE_CHANGED', 'CONCURRENT_UPDATE']).toContain(loser.body.code)
      const rows = await corrections(article.id)
      expect(rows).toHaveLength(1)
      const winnerContent = (rows[0].proposed as { content: string }).content
      expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(winnerContent)
    }
  })

  it('a double click or replay with the same submission key creates one record and returns it to every request', async () => {
    const article = await makeArticle()
    const body = { ...(await draft(article.id)), publish: true, confirm: true }
    const results = await Promise.all(Array.from({ length: 5 }, () => create(article.id, body)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201])
    const ids_ = new Set(results.map((r) => r.body.correction.id))
    expect(ids_.size).toBe(1)
    expect(results.filter((r) => r.body.replayed)).toHaveLength(4)
    expect(await corrections(article.id)).toHaveLength(1)
    expect(await db.notification.count({ where: { articleId: article.id, type: 'correction_published' } })).toBe(1)

    // A later replay (e.g. a retried request after a lost response) still returns the same record.
    const later = await create(article.id, body)
    expect(later).toMatchObject({ status: 200, body: { replayed: true, correction: { id: [...ids_][0] } } })
    // The same key from someone else is refused rather than leaking the record.
    as('admin2')
    expect((await create(article.id, body)).body.code).toBe('DUPLICATE_REQUEST')
  })

  // ── Atomicity ──────────────────────────────────────────────────────────────────────────────────

  it('rolls everything back when any part of the publication fails', async () => {
    const article = await makeArticle()
    await withConnection(async (c) => {
      await c.query(`CREATE OR REPLACE FUNCTION corr_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action = 'correction.published' AND NEW."targetId" = '${article.id}' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$`)
      await c.query(`CREATE TRIGGER corr_test_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION corr_test_fail()`)
    })
    try {
      const res = await publishNow(article.id)
      expect(res.status).toBe(500)
      expect(res.body.code).toBe('CORRECTION_FAILED')
    } finally {
      await withConnection(async (c) => {
        await c.query('DROP TRIGGER IF EXISTS corr_test_fail ON audit_logs')
        await c.query('DROP FUNCTION IF EXISTS corr_test_fail()')
      })
    }
    const row = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(row).toMatchObject({ content: ORIGINAL, corrected: false, correctionNote: null, updatedAt: article.updatedAt })
    expect(await corrections(article.id)).toHaveLength(0) // not even the PENDING row of the same transaction
    expect(await db.auditLog.count({ where: { targetId: article.id } })).toBe(0)
    expect(cache.stats.invalidations).toEqual([])
    expect(await db.notification.count({ where: { articleId: article.id } })).toBe(0)
  })

  it('a notification or cache failure after the commit is a warning, never a failed correction', async () => {
    const article = await makeArticle()
    await withConnection(async (c) => {
      await c.query(`CREATE OR REPLACE FUNCTION corr_test_fail_notify() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW."articleId" = '${article.id}' THEN RAISE EXCEPTION 'simulated notification outage'; END IF; RETURN NEW; END $$`)
      await c.query(`CREATE TRIGGER corr_test_fail_notify BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION corr_test_fail_notify()`)
    })
    cache.failInvalidations(true)
    try {
      const res = await publishNow(article.id)
      expect(res.status).toBe(201)
      expect(res.body.published).toBe(true)
      expect(res.body.warnings.map((w: { stage: string }) => w.stage).sort()).toEqual(['cache', 'notification'])
    } finally {
      cache.failInvalidations(false)
      await withConnection(async (c) => {
        await c.query('DROP TRIGGER IF EXISTS corr_test_fail_notify ON notifications')
        await c.query('DROP FUNCTION IF EXISTS corr_test_fail_notify()')
      })
    }
    expect((await corrections(article.id))[0].status).toBe('PUBLISHED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(CORRECTED)
  })

  // ── Permanence ─────────────────────────────────────────────────────────────────────────────────

  it('published and withdrawn records are permanent, even to raw SQL; only deleting the article removes them', async () => {
    const article = await makeArticle()
    const published = (await publishNow(article.id)).body.correction
    as('editor')
    const pending = (await create(article.id, await draft(article.id, { type: 'UPDATE', content: CORRECTED, publicNote: 'Update note' }))).body.correction

    await withConnection(async (c) => {
      await expect(c.query(`UPDATE article_corrections SET "publicNote" = 'rewritten' WHERE id = $1`, [published.id])).rejects.toThrow(/CORRECTION_RECORD_PROTECTED/)
      await expect(c.query(`UPDATE article_corrections SET status = 'WITHDRAWN', "withdrawnAt" = now() WHERE id = $1`, [published.id])).rejects.toThrow(/CORRECTION_RECORD_PROTECTED/)
      await expect(c.query(`DELETE FROM article_corrections WHERE id = $1`, [published.id])).rejects.toThrow(/CORRECTION_RECORD_PROTECTED/)
      await expect(c.query(`DELETE FROM article_corrections WHERE id = $1`, [pending.id])).rejects.toThrow(/CORRECTION_RECORD_PROTECTED/)
      await expect(c.query(`UPDATE article_corrections SET "articleId" = $2 WHERE id = $1`, [pending.id, article.id + 'x'])).rejects.toThrow()
      // A published row without its approver or snapshots cannot exist.
      await expect(c.query(`INSERT INTO article_corrections (id, "articleId", type, status, "publicNote", "baseVersion", proposed, "requestKey", "createdById", "publishedAt", "updatedAt")
        VALUES ('forged', $1, 'CORRECTION', 'PUBLISHED', 'forged', 'v', '{}', 'forged-key-000000000', $2, now(), now())`, [article.id, ids.admin])).rejects.toThrow(/article_corrections_published_check/)
    })
    expect((await db.articleCorrection.findUniqueOrThrow({ where: { id: published.id } })).publicNote).toBe(published.publicNote)

    as('admin')
    const withdrawn = await patch(article.id, pending.id, { action: 'withdraw', reason: 'Not needed', expectedUpdatedAt: pending.updatedAt })
    expect(withdrawn.status).toBe(200)
    await withConnection(async (c) => {
      await expect(c.query(`UPDATE article_corrections SET "withdrawnReason" = 'changed' WHERE id = $1`, [pending.id])).rejects.toThrow(/CORRECTION_RECORD_PROTECTED/)
    })
    // The API never offers to change a published record.
    expect((await patch(article.id, published.id, { action: 'withdraw', reason: 'x', expectedUpdatedAt: published.updatedAt })).body.code).toBe('CORRECTION_NOT_PENDING')

    // Permanent deletion of the article itself (trash purge, account deletion) cascades, but the public text of
    // each published notice is kept in the internal audit log first.
    await db.article.delete({ where: { id: article.id } })
    expect(await db.articleCorrection.count({ where: { articleId: article.id } })).toBe(0)
    const archived = await db.auditLog.findMany({ where: { targetId: article.id, action: 'correction.removed_with_article' } })
    expect(archived).toHaveLength(1) // the published correction; the withdrawn one was never public
    expect(archived[0]).toMatchObject({ performedBy: 'system:article-deletion', metadata: { correctionId: published.id, type: 'CORRECTION', publicNote: published.publicNote } })
    await db.auditLog.deleteMany({ where: { targetId: article.id } })
  })

  it('a published note is amended by a superseding record, once; the original stays intact', async () => {
    const article = await makeArticle()
    const original = (await publishNow(article.id)).body.correction
    const amendment = await publishNow(article.id, {
      supersedesId: original.id, content: CORRECTED, originalText: 'note said September', correctedText: 'it was August',
      publicNote: 'Our correction of this article gave the wrong month; the figure was for August.',
    })
    expect(amendment.status).toBe(201)
    expect(amendment.body.correction.supersedesId).toBe(original.id)
    const twice = await publishNow(article.id, { supersedesId: original.id, content: CORRECTED, publicNote: 'Another amendment' })
    expect(twice.status).toBe(409)
    expect(twice.body.code).toBe('CORRECTION_ALREADY_AMENDED')
    const rows = await corrections(article.id)
    expect(rows.map((r) => r.publicNote)).toEqual([original.publicNote, amendment.body.correction.publicNote])

    const other = await makeArticle()
    const cross = await publishNow(other.id, { supersedesId: original.id, content: CORRECTED })
    expect(cross.status).toBe(400)
  })

  it('a withdrawn amendment does not block a later amendment of the same note', async () => {
    const article = await makeArticle()
    const original = (await publishNow(article.id)).body.correction
    as('editor')
    const pending = (await create(article.id, await draft(article.id, { supersedesId: original.id, content: CORRECTED, publicNote: 'First attempt at an amendment' }))).body.correction
    expect((await patch(article.id, pending.id, { action: 'withdraw', reason: 'Wrong wording', expectedUpdatedAt: pending.updatedAt })).status).toBe(200)
    as('admin')
    const second = await publishNow(article.id, { supersedesId: original.id, content: CORRECTED, publicNote: 'Our correction gave the wrong month; the figure was for August.' })
    expect(second.status).toBe(201)
    expect((await corrections(article.id)).map((c) => [c.status, c.supersedesId])).toEqual([
      ['PUBLISHED', null], ['WITHDRAWN', original.id], ['PUBLISHED', original.id],
    ])
  })

  it('revising a pending correction against a changed article is refused (no lost update)', async () => {
    const article = await makeArticle()
    as('editor')
    const pending = (await create(article.id, await draft(article.id))).body.correction
    await db.article.update({ where: { id: article.id }, data: { title: `${article.title} (copy edited)` } })
    // The form revises from the version the proposal was prepared against, never the newer one.
    const res = await patch(article.id, pending.id, {
      action: 'revise', ...(await draft(article.id, { title: article.title, publicNote: 'Revised' })),
      baseVersion: pending.baseVersion, expectedUpdatedAt: pending.updatedAt,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ARTICLE_CHANGED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).title).toBe(`${article.title} (copy edited)`)
  })

  // ── Rollback mirror, URL, byline and media ─────────────────────────────────────────────────────

  it('the legacy mirror lists every published notice, oldest first, with its own label and date', async () => {
    const article = await makeArticle()
    await publishNow(article.id)
    await publishNow(article.id, { type: 'CLARIFICATION', content: CORRECTED, correctedText: '', publicNote: 'Clarified: seasonally adjusted figure.' })
    await publishNow(article.id, { type: 'UPDATE', content: CORRECTED, originalText: '', correctedText: '', publicNote: 'Updated with the October figures.' })
    const row = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const parts = row.correctionNote!.split('\n\n')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatch(/^Correction \(.+\): An earlier version/)
    expect(parts[1]).toBe(`Clarification (${parts[1].match(/\((.+?)\)/)![1]}): Clarified: seasonally adjusted figure.`)
    expect(parts[2]).toMatch(/^Update \(.+\): Updated with the October figures\.$/)
    expect(row.corrected).toBe(true)
  })

  it("a published article's web address is locked; other slug changes are audited", async () => {
    const article = await makeArticle()
    const loaded = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const res = await saveArticle(req(`/api/articles/${article.id}`, 'PUT', { slug: `${article.slug}-renamed`, expectedUpdatedAt: loaded.updatedAt.toISOString() }), ctx(article.id))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PUBLISHED_SLUG_LOCKED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).slug).toBe(article.slug)
    // Re-sending the same slug (what the editor does on every save) is fine.
    expect((await saveArticle(req(`/api/articles/${article.id}`, 'PUT', { slug: article.slug, tags: [] }), ctx(article.id))).status).toBe(200)

    const draftArticle = await makeArticle({ status: 'DRAFT', publishedAt: null })
    const renamed = await saveArticle(req(`/api/articles/${draftArticle.id}`, 'PUT', { slug: `${draftArticle.slug}-renamed` }), ctx(draftArticle.id))
    expect(renamed.status).toBe(200)
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: draftArticle.id, action: 'article.slug_changed' } })
    expect(audit.metadata).toMatchObject({ before: draftArticle.slug, after: `${draftArticle.slug}-renamed`, status: 'DRAFT' })
  })

  it('a live byline cannot be changed by an ordinary save; a correction changes it atomically with its note', async () => {
    const article = await makeArticle()
    const loaded = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const res = await saveArticle(req(`/api/articles/${article.id}`, 'PUT', { authorId: ids.editor, expectedUpdatedAt: loaded.updatedAt.toISOString(), editKind: 'COPY_EDIT' }), ctx(article.id))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PUBLISHED_BYLINE_LOCKED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).authorId).toBe(ids.writer)

    const bad = await publishNow(article.id, { content: ORIGINAL, authorId: ids.reader, publicNote: 'Byline corrected.' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('INVALID_AUTHOR')

    const fixed = await publishNow(article.id, {
      content: ORIGINAL, authorId: ids.editor, originalText: 'Byline: writer', correctedText: 'Byline: editor',
      publicNote: 'An earlier version of this article was attributed to the wrong author.',
    })
    expect(fixed.status).toBe(201)
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).authorId).toBe(ids.editor)
    const [c] = await corrections(article.id)
    expect(c.previous).toMatchObject({ authorId: ids.writer, authorName: `writer ${tag}` })
    expect(c.proposed).toMatchObject({ authorId: ids.editor, authorName: `editor ${tag}` })
    // Both the previous and the new author are told.
    const told = await db.notification.findMany({ where: { articleId: article.id, type: 'correction_published' }, select: { userId: true } })
    expect(told.map((t) => t.userId).sort()).toEqual([ids.editor, ids.writer].sort())
  })

  it('a live cover image changes only as a declared copy edit (audited) or through a correction', async () => {
    const article = await makeArticle({ coverImage: '/images/original-cover.png' })
    let loaded = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const silent = await saveArticle(req(`/api/articles/${article.id}`, 'PUT', { coverImage: '/images/other.png', expectedUpdatedAt: loaded.updatedAt.toISOString() }), ctx(article.id))
    expect(silent.status).toBe(409)
    expect((await silent.json()).code).toBe('PUBLISHED_TEXT_CHANGE_UNCLASSIFIED')

    const crop = await saveArticle(req(`/api/articles/${article.id}`, 'PUT', { coverImage: '/images/original-cover-cropped.png', editKind: 'COPY_EDIT', expectedUpdatedAt: loaded.updatedAt.toISOString() }), ctx(article.id))
    expect(crop.status).toBe(200)
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: article.id, action: 'article.copy_edit' } })
    expect(audit.metadata).toMatchObject({ fields: ['coverImage'], before: { coverImage: '/images/original-cover.png' }, after: { coverImage: '/images/original-cover-cropped.png' } })

    loaded = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const wrongPicture = await publishNow(article.id, {
      type: 'CORRECTION', content: ORIGINAL, coverImage: '/images/correct-person.png',
      originalText: 'Cover photo showed the wrong minister', correctedText: 'Replaced with the correct photo',
      publicNote: 'An earlier version of this article was illustrated with a photograph of the wrong person.',
    })
    expect(wrongPicture.status).toBe(201)
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).coverImage).toBe('/images/correct-person.png')
    expect((await corrections(article.id))[0]).toMatchObject({ previous: { coverImage: '/images/original-cover-cropped.png' }, proposed: { coverImage: '/images/correct-person.png' } })
  })

  // ── Other editing paths ────────────────────────────────────────────────────────────────────────

  it('the article editor cannot silently change a live article: unclassified text changes are refused, copy edits are audited', async () => {
    const article = await makeArticle()
    const loaded = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const save = (body: Record<string, unknown>) => saveArticle(req(`/api/articles/${article.id}`, 'PUT', body), ctx(article.id))

    const silent = await save({ content: CORRECTED, status: 'PUBLISHED', expectedUpdatedAt: loaded.updatedAt.toISOString() })
    expect(silent.status).toBe(409)
    expect((await silent.json()).code).toBe('PUBLISHED_TEXT_CHANGE_UNCLASSIFIED')
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(ORIGINAL)

    for (const bad of [{ title: 42 }, { content: { type: 'doc' } }, { excerpt: ['x'] }]) {
      const res = await save({ ...bad, status: 'PUBLISHED', editKind: 'COPY_EDIT', expectedUpdatedAt: loaded.updatedAt.toISOString() })
      expect(res.status).toBe(400)
    }

    const legacy = await save({ corrected: true, correctionNote: 'sneaky', expectedUpdatedAt: loaded.updatedAt.toISOString() })
    expect(legacy.status).toBe(400)
    expect((await legacy.json()).code).toBe('USE_CORRECTIONS_WORKFLOW')

    const typo = doc('Unemployment rose to 5.2% in Septmber.', 'Wages grew by 3%.')
    await db.article.update({ where: { id: article.id }, data: { content: typo } })
    const fresh = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const fixed = await save({ content: ORIGINAL, status: 'PUBLISHED', editKind: 'COPY_EDIT', expectedUpdatedAt: fresh.updatedAt.toISOString() })
    expect(fixed.status).toBe(200)
    const after = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(after).toMatchObject({ content: ORIGINAL, status: 'PUBLISHED', publishedAt: PUBLISHED_AT })
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: article.id, action: 'article.copy_edit' } })
    expect(audit.performedBy).toBe(ids.admin)
    expect(audit.metadata).toMatchObject({ fields: ['content'], before: { content: typo }, after: { content: ORIGINAL } })
    expect(await corrections(article.id)).toHaveLength(0) // a copy edit is not a public notice

    // Metadata-only saves on a live article need no classification and write no copy-edit record.
    const meta = await save({ tags: [`${tag} topic`], expectedUpdatedAt: after.updatedAt.toISOString() })
    expect(meta.status).toBe(200)
    expect(await db.auditLog.count({ where: { targetId: article.id, action: 'article.copy_edit' } })).toBe(1)
    await db.articleTag.deleteMany({ where: { articleId: article.id } })
    await db.tag.deleteMany({ where: { name: `${tag} topic` } })

    // Drafts keep autosaving as before.
    const draftArticle = await makeArticle({ status: 'DRAFT', publishedAt: null })
    const draftSave = await saveArticle(req(`/api/articles/${draftArticle.id}`, 'PUT', { content: CORRECTED }), ctx(draftArticle.id))
    expect(draftSave.status).toBe(200)

    // Unpublishing with an edit is a confirmed visibility change, not a silent live rewrite: allowed as before.
    const latest = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    const unpublish = await save({ content: CORRECTED, status: 'DRAFT', publicationIntent: true, expectedUpdatedAt: latest.updatedAt.toISOString() })
    expect(unpublish.status).toBe(200)
    expect(await db.article.findUniqueOrThrow({ where: { id: article.id } })).toMatchObject({ status: 'DRAFT', content: CORRECTED })
  })

  it('the retired review "correct" action changes nothing', async () => {
    const article = await makeArticle()
    const res = await reviewArticle(req(`/api/editorial/articles/${article.id}/review`, 'PATCH', { action: 'correct', corrected: true, correctionNote: 'x' }), ctx(article.id))
    expect(res.status).toBe(410)
    expect(await db.article.findUniqueOrThrow({ where: { id: article.id } })).toEqual(article)
  })

  it('the public article API exposes no internal correction data', async () => {
    const article = await makeArticle()
    await publishNow(article.id)
    as(null)
    const res = await readArticle(req(`/api/articles/${article.id}`, 'GET'), ctx(article.id))
    const text = JSON.stringify(await res.json())
    expect(res.status).toBe(200)
    expect(text).not.toContain('Internal:')
    expect(text).not.toContain('"proposed"')
    expect(text).not.toContain('"previous"')
  })

  it('staff history includes internal fields and copy edits; the preview renders through the public sanitiser', async () => {
    const article = await makeArticle()
    await publishNow(article.id)
    const res = await listCorrections(req('/x', 'GET'), ctx(article.id))
    const body = await res.json()
    expect(body.corrections[0]).toMatchObject({ internalNote: 'Internal: ONS table 3, flagged by a reader.' })
    expect(body.version).toBe(await versionOf(article.id))
    expect(body.viewer).toEqual({ id: ids.admin, canApprove: true })

    const hostile = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }] })
    const preview = await (await previewCorrection(req('/x', 'POST', { content: hostile }), ctx(article.id))).json()
    expect(preview.html).not.toContain('<script>')
    expect(preview.html).toContain('&lt;script&gt;')
  })

  it('scheduled publishing is unaffected and never applies or creates corrections', async () => {
    const corrected = await makeArticle()
    await publishNow(corrected.id)
    const scheduled = await makeArticle({ status: 'SCHEDULED', publishedAt: null, scheduledAt: new Date(Date.now() - 60_000) })
    const result = await publishScheduledArticles()
    expect(result.published.map((p) => p.id)).toContain(scheduled.id)
    expect((await db.article.findUniqueOrThrow({ where: { id: scheduled.id } })).status).toBe('PUBLISHED')
    expect(await corrections(scheduled.id)).toHaveLength(0)
    expect((await corrections(corrected.id))).toHaveLength(1)
  })

  // ── Legacy data ────────────────────────────────────────────────────────────────────────────────

  it('migrates legacy single-note corrections without inventing a date, idempotently, leaving the old fields intact', async () => {
    const withNote = await makeArticle({ corrected: true, correctionNote: '  Rate was 4.5%, not 5%.  ' })
    const withoutNote = await makeArticle({ corrected: true, correctionNote: null })
    const notCorrected = await makeArticle({ corrected: false, correctionNote: 'An unpublished draft note' })
    const sql = readFileSync('supabase/migrations/20261017120000_article_corrections.sql', 'utf8')
    await withConnection(async (c) => { await c.query(sql); await c.query(sql) })

    const legacy = await db.articleCorrection.findMany({ where: { articleId: { in: [withNote.id, withoutNote.id, notCorrected.id] } } })
    expect(legacy).toHaveLength(2)
    const a = legacy.find((l) => l.articleId === withNote.id)!
    expect(a).toMatchObject({ id: `legacy_${withNote.id}`, legacy: true, status: 'PUBLISHED', type: 'CORRECTION', publicNote: 'Rate was 4.5%, not 5%.', publishedAt: null, createdById: null })
    expect(legacy.find((l) => l.articleId === withoutNote.id)!.publicNote).toBeNull()
    expect(await db.article.findUniqueOrThrow({ where: { id: withNote.id } })).toMatchObject({ corrected: true, correctionNote: '  Rate was 4.5%, not 5%.  ' })

    const pub = await loadPublicCorrections(db as never, await db.article.findUniqueOrThrow({ where: { id: withNote.id } }))
    expect(pub).toEqual([{ id: `legacy_${withNote.id}`, type: 'CORRECTION', publicNote: 'Rate was 4.5%, not 5%.', publishedAt: null, legacy: true, supersedesId: null }])

    // A new correction on a legacy article is listed after the undated legacy note.
    await publishNow(withNote.id)
    const both = await loadPublicCorrections(db as never, await db.article.findUniqueOrThrow({ where: { id: withNote.id } }))
    expect(both.map((p) => p.legacy)).toEqual([true, false])
  })
})
