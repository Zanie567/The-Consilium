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

import { PUT } from '@/app/api/articles/[id]/route'

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
