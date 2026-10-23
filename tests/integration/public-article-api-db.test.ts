/**
 * The public JSON article API (GET /api/articles and GET /api/articles/[id]) against a real database.
 *
 * Before this test, both endpoints returned whole Prisma rows to anonymous visitors, including editorial
 * notes, commendations, engagement scores and schedule times, and neither applied the hidden-debate rule
 * the pages use. Visitors now get the canonical visibility rule and an explicit column allowlist; the
 * article's author and editorial staff keep the full record they need for editing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { PUBLIC_ARTICLE_SELECT } from '@/lib/publicArticle'

const TEST_DB = process.env.TEST_DATABASE_URL
const suite = TEST_DB ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string; role: string } } }
})
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }) }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { ...state.session, isActive: true } } : null) }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }))

import { GET as listArticles } from '@/app/api/articles/route'
import { GET as readArticle } from '@/app/api/articles/[id]/route'

const INTERNAL = ['editorNote', 'editorialCommendation', 'engagementScore', 'scheduledAt', 'deletedAt', 'hiddenByDebateAt', 'isDebate']
const tag = `pa-${Date.now()}`
const ids = { writer: '', editor: '', category: '' }
let db: PrismaClient
const req = (url: string) => new NextRequest(`http://localhost${url}`)
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function setGuard(on: boolean) {
  const c = new Client({ connectionString: TEST_DB! })
  await c.connect()
  try { await c.query(`ALTER TABLE articles ${on ? 'ENABLE' : 'DISABLE'} TRIGGER articles_hidden_debate_guard`) } finally { await c.end() }
}

const article = (label: string, extra: object = {}) => db.article.create({
  data: {
    title: `${tag} ${label}`, slug: `${tag}-${label}`, content: '{}', excerpt: label, authorId: ids.writer,
    categoryId: ids.category, status: 'PUBLISHED', publishedAt: new Date(), editorNote: 'Private review discussion',
    editorialCommendation: 'Internal award discussion', engagementScore: 73, ...extra,
  },
})

suite('public article API: visibility rule and column allowlist (real database)', () => {
  let visible: { id: string }, trashed: { id: string }, inHiddenDebate: { id: string }
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    ids.writer = (await db.user.create({ data: { email: `${tag}-writer@ed.ac.uk`, name: `writer ${tag}`, role: 'WRITER', emailVerified: new Date() } })).id
    ids.editor = (await db.user.create({ data: { email: `${tag}-admin@ed.ac.uk`, name: `admin ${tag}`, role: 'ADMIN', emailVerified: new Date() } })).id
    ids.category = (await db.category.create({ data: { name: tag, slug: tag } })).id
    visible = await article('visible')
    trashed = await article('trashed', { deletedAt: new Date() })
    const otherSide = await article('other-side', { isDebate: true })
    await setGuard(false) // models a row that predates the database guard
    try {
      inHiddenDebate = await article('hidden-debate', { isDebate: true })
      await db.debate.create({ data: { title: `${tag} debate`, forArticleId: inHiddenDebate.id, againstArticleId: otherSide.id, isActive: false, unpublishedAt: new Date() } })
    } finally { await setGuard(true) }
  })
  afterAll(async () => {
    await setGuard(true)
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.category.deleteMany({ where: { slug: tag } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('the published list returns live articles with public columns only', async () => {
    state.session = null
    const response = await listArticles(req(`/api/articles?category=${tag}&limit=50`))
    expect(response.status).toBe(200)
    const rows = (await response.json()) as Record<string, unknown>[]
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([visible.id]))
    expect(rows.map((r) => r.id)).not.toContain(trashed.id)
    expect(rows.map((r) => r.id)).not.toContain(inHiddenDebate.id)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...Object.keys(PUBLIC_ARTICLE_SELECT), 'author', 'category'].sort())
      for (const key of INTERNAL) expect(row).not.toHaveProperty(key)
    }
  })

  it('a single published article is projected for visitors; trashed and hidden-debate articles are not found', async () => {
    state.session = null
    const response = await readArticle(req(`/api/articles/${visible.id}`), ctx(visible.id))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ id: visible.id, title: `${tag} visible`, content: '{}' })
    expect(body.author).toMatchObject({ id: ids.writer })
    for (const key of INTERNAL) expect(body).not.toHaveProperty(key)
    expect(JSON.stringify(body)).not.toContain('Private review discussion')

    expect((await readArticle(req(`/api/articles/${trashed.id}`), ctx(trashed.id))).status).toBe(404)
    expect((await readArticle(req(`/api/articles/${inHiddenDebate.id}`), ctx(inHiddenDebate.id))).status).toBe(404)
  })

  it('a signed-in reader who is not the author gets the same public projection', async () => {
    const reader = await db.user.create({ data: { email: `${tag}-reader@ed.ac.uk`, name: `reader ${tag}`, role: 'READER', emailVerified: new Date() } })
    state.session = { id: reader.id, role: 'READER' }
    const body = await (await readArticle(req(`/api/articles/${visible.id}`), ctx(visible.id))).json()
    for (const key of INTERNAL) expect(body).not.toHaveProperty(key)
  })

  it('the author and editorial staff still receive the full editing record', async () => {
    state.session = { id: ids.writer, role: 'WRITER' }
    const own = await (await readArticle(req(`/api/articles/${visible.id}`), ctx(visible.id))).json()
    expect(own).toMatchObject({ id: visible.id, editorNote: 'Private review discussion' })
    expect(own.version).toBeTruthy()
    state.session = { id: ids.editor, role: 'ADMIN' }
    const staff = await (await readArticle(req(`/api/articles/${visible.id}`), ctx(visible.id))).json()
    expect(staff).toMatchObject({ id: visible.id, editorNote: 'Private review discussion' })
  })
})
