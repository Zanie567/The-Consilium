import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, authMock } = vi.hoisted(() => ({
  prismaMock: {
    article: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    articleTag: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    tag: { upsert: vi.fn() },
    categoryEditor: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  authMock: {
    authOptions: {},
    requireActiveSession: vi.fn(),
    requireVerifiedSessionUser: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
  articleSubmittedEmail: vi.fn(() => ({ subject: 'subject', html: 'html' })),
}))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: vi.fn() }))

import { PUT, DELETE } from '@/app/api/articles/[id]/route'
import { articleVersion } from '@/lib/articleVersion'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test' }
const EDITOR = { id: 'editor-1', role: 'EDITOR', name: 'Editor', email: 'editor@test' }
const WRITER = { id: 'writer-1', role: 'WRITER', name: 'Writer', email: 'writer@test' }

const existing = {
  id: 'article-1',
  title: 'Analysis draft',
  slug: 'analysis-draft',
  content: '{}',
  excerpt: null,
  coverImage: null,
  categoryId: 'analysis',
  authorId: 'writer-1',
  status: 'PENDING_REVIEW',
  publishedAt: null,
  scheduledAt: null,
  deletedAt: null,
  author: { id: 'writer-1', name: 'Writer' },
  category: { id: 'analysis', name: 'Analysis' },
  tags: [] as { tag: { name: string } }[],
}

function request(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/articles/article-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: existing.title,
      content: existing.content,
      categoryId: existing.categoryId,
      status: existing.status,
      ...body,
    }),
  })
}

const params = { params: Promise.resolve({ id: 'article-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.article.findUnique.mockResolvedValue(existing)
  prismaMock.article.update.mockResolvedValue(existing)
  prismaMock.categoryEditor.findMany.mockResolvedValue([])
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock)
  )
})

describe('PUT /api/articles/[id] editor saves', () => {
  it('returns 401 when the session has expired', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: 'Your session has expired.', code: 'AUTH_REQUIRED' },
        { status: 401 }
      ),
    })

    const response = await PUT(request(), params)

    expect(response.status).toBe(401)
    expect(prismaMock.article.findUnique).not.toHaveBeenCalled()
  })

  it('allows an admin to save a pending-review Analysis article', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })

    const response = await PUT(request(), params)

    expect(response.status).toBe(200)
    expect(prismaMock.article.update).toHaveBeenCalledOnce()
  })

  it('allows a global editor with zero assignments to save it', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: EDITOR })
    prismaMock.categoryEditor.findMany.mockResolvedValue([])

    const response = await PUT(request(), params)

    expect(response.status).toBe(200)
    expect(prismaMock.article.update).toHaveBeenCalledOnce()
  })

  it('allows an editor assigned to Analysis to save it', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: EDITOR })
    prismaMock.categoryEditor.findMany.mockResolvedValue([{ categoryId: 'analysis' }])

    const response = await PUT(request(), params)

    expect(response.status).toBe(200)
  })

  it('returns a specific 403 for an editor outside the category', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: EDITOR })
    prismaMock.categoryEditor.findMany.mockResolvedValue([{ categoryId: 'markets' }])

    const response = await PUT(request(), params)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'CATEGORY_SCOPE_DENIED' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('does not let a scoped editor move an article out of scope', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: EDITOR })
    prismaMock.categoryEditor.findMany.mockResolvedValue([{ categoryId: 'analysis' }])

    const response = await PUT(request({ categoryId: 'markets' }), params)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'CATEGORY_SCOPE_DENIED' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('keeps writers from editing an article already under review', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: WRITER })

    const response = await PUT(request(), params)

    expect(response.status).toBe(400)
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })
})

describe('PUT /api/articles/[id] optimistic concurrency (baseVersion)', () => {
  const currentVersion = () => articleVersion(existing, existing.tags.map((t) => t.tag.name))

  beforeEach(() => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })
  })

  it('saves when the client was editing the current version, and returns the new version', async () => {
    const response = await PUT(request({ baseVersion: currentVersion() }), params)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(typeof body.version).toBe('string')
    expect(body.version).toHaveLength(24)
  })

  it('refuses a stale version with 409 ARTICLE_CONFLICT and writes nothing', async () => {
    const response = await PUT(request({ baseVersion: 'stale-version-from-another-tab' }), params)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('ARTICLE_CONFLICT')
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('does not check clients that send no baseVersion (scripts, older pages)', async () => {
    const response = await PUT(request(), params)
    expect(response.status).toBe(200)
  })

  it('treats a tag change by someone else as a conflict', async () => {
    const stale = currentVersion()
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, tags: [{ tag: { name: 'added-elsewhere' } }] })
    const response = await PUT(request({ baseVersion: stale }), params)
    expect(response.status).toBe(409)
  })
})

describe('PUT /api/articles/[id] publication intent', () => {
  beforeEach(() => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })
  })

  const as = (status: string, extra: Record<string, unknown> = {}) => request({ status, ...extra })

  it.each([
    ['publishing a draft', 'DRAFT', 'PUBLISHED'],
    ['scheduling a draft', 'DRAFT', 'SCHEDULED'],
    ['unpublishing to draft', 'PUBLISHED', 'DRAFT'],
    ['archiving a live article', 'PUBLISHED', 'ARCHIVED'],
    ['cancelling a schedule', 'SCHEDULED', 'DRAFT'],
  ])('refuses %s without publicationIntent (409) and writes nothing', async (_n, from, to) => {
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: from, scheduledAt: from === 'SCHEDULED' ? new Date('2031-01-01') : null })
    const response = await PUT(as(to, { scheduledAt: '2031-01-01T10:00' }), params)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PUBLICATION_CONFIRMATION_REQUIRED')
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('allows restating the current status (an ordinary save) with no intent', async () => {
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: 'PUBLISHED' })
    expect((await PUT(as('PUBLISHED'), params)).status).toBe(200)
  })

  it('allows non-public transitions (submit for review) with no intent', async () => {
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: 'DRAFT' })
    expect((await PUT(as('PENDING_REVIEW'), params)).status).toBe(200)
  })

  it('allows publishing with publicationIntent', async () => {
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: 'DRAFT' })
    expect((await PUT(as('PUBLISHED', { publicationIntent: true }), params)).status).toBe(200)
  })

  it('does not accept a truthy string as intent', async () => {
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: 'DRAFT' })
    expect((await PUT(as('PUBLISHED', { publicationIntent: 'true' }), params)).status).toBe(409)
  })
})

describe('DELETE /api/articles/[id] (move to trash)', () => {
  const del = () => DELETE(new NextRequest('http://localhost/api/articles/article-1', { method: 'DELETE' }), params)

  it.each([['DRAFT'], ['REJECTED']])('lets a writer trash their own %s article', async (status) => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: WRITER })
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status })
    expect((await del()).status).toBe(200)
    expect(prismaMock.article.update).toHaveBeenCalled()
  })

  it.each([['PENDING_REVIEW'], ['SCHEDULED'], ['PUBLISHED'], ['ARCHIVED']])('refuses a writer trashing their own %s article (it would pull it from the queue or the site)', async (status) => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: WRITER })
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status })
    const res = await del()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ARTICLE_LOCKED_FOR_WRITER')
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('refuses a writer trashing someone else\'s draft', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: { ...WRITER, id: 'writer-2' } })
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: 'DRAFT' })
    expect((await del()).status).toBe(403)
  })

  it('lets an editor trash a published article', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })
    prismaMock.article.findUnique.mockResolvedValue({ ...existing, status: 'PUBLISHED' })
    expect((await del()).status).toBe(200)
  })
})
