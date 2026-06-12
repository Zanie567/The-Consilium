/**
 * In-process authorization tests for the inline review comment routes.
 *
 * The enforced matrix:
 *   ADMIN                      full access to comments on any article
 *   EDITOR (in category scope) full access
 *   EDITOR (out of scope)      denied unless they authored the article
 *   WRITER                     read, comment (top-level AND replies), and
 *                              resolve on their OWN articles only
 *   GROWTH / READER / no user  denied
 *
 * Like comments-resilience.test.ts these run with prisma and auth mocked, so
 * no server or database is needed and they run on every `npm test`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, authMock } = vi.hoisted(() => ({
  prismaMock: {
    article: { findUnique: vi.fn() },
    categoryEditor: { findFirst: vi.fn() },
    articleComment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    notification: { create: vi.fn(), createMany: vi.fn() },
  },
  authMock: { getVerifiedSessionUser: vi.fn(), authOptions: {} },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)

import { GET, POST } from '@/app/api/articles/[id]/comments/route'
import { PATCH } from '@/app/api/articles/[id]/comments/[commentId]/route'

const ARTICLE = {
  id: 'article-1',
  authorId: 'writer-1',
  title: 'On Inflation',
  categoryId: null,
  deletedAt: null,
}

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test' }
const EDITOR = { id: 'editor-1', role: 'EDITOR', name: 'Ed', email: 'ed@test' }
const OWNER_WRITER = { id: 'writer-1', role: 'WRITER', name: 'Wren', email: 'wren@test' }
const OTHER_WRITER = { id: 'writer-2', role: 'WRITER', name: 'Other', email: 'other@test' }
const READER = { id: 'reader-1', role: 'READER', name: 'Reader', email: 'reader@test' }
const GROWTH = { id: 'growth-1', role: 'GROWTH', name: 'Growth', email: 'growth@test' }

const params = () => ({ params: Promise.resolve({ id: 'article-1' }) })
const patchParams = () =>
  ({ params: Promise.resolve({ id: 'article-1', commentId: 'comment-1' }) })

const jsonReq = (body: unknown) =>
  new Request('http://localhost/api/articles/article-1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const baseComment = {
  id: 'comment-1',
  articleId: 'article-1',
  authorId: 'editor-1',
  commentText: 'Tighten this paragraph.',
  resolved: false,
  createdAt: new Date('2026-06-01T10:00:00Z'),
  parentId: null,
  tiptapFrom: 5,
  tiptapTo: 25,
  quotedText: 'the quoted selection',
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.article.findUnique.mockResolvedValue(ARTICLE)
  prismaMock.categoryEditor.findFirst.mockResolvedValue(null)
  prismaMock.articleComment.findMany.mockResolvedValue([])
  prismaMock.articleComment.create.mockResolvedValue(baseComment)
  prismaMock.notification.create.mockResolvedValue({})
  prismaMock.notification.createMany.mockResolvedValue({ count: 1 })
})

// ── GET: who can read comments ────────────────────────────────────────────────

describe('GET /api/articles/[id]/comments authorization', () => {
  it('allows a writer to read comments on their own article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(200)
  })

  it('denies a writer reading another writer\'s article comments', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OTHER_WRITER)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(403)
    expect(prismaMock.articleComment.findMany).not.toHaveBeenCalled()
  })

  it('denies unauthenticated access', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(401)
    expect(prismaMock.articleComment.findMany).not.toHaveBeenCalled()
  })

  it('denies the reader role', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(READER)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(403)
  })

  it('denies the growth role', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(GROWTH)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(403)
  })

  it('allows admins on any article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(200)
  })

  it('allows an unscoped editor, blocks a category-scoped editor on an out-of-scope article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(EDITOR)
    // Unscoped editor (no category assignments) on an uncategorised article.
    const ok = await GET(new Request('http://localhost'), params())
    expect(ok.status).toBe(200)

    // Scoped editor, article in a category they are not assigned to.
    prismaMock.article.findUnique.mockResolvedValue({ ...ARTICLE, categoryId: 'cat-1' })
    prismaMock.categoryEditor.findFirst.mockResolvedValue(null)
    const blocked = await GET(new Request('http://localhost'), params())
    expect(blocked.status).toBe(403)
  })

  it('404s for a missing or deleted article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost'), params())
    expect(res.status).toBe(404)
  })
})

// ── POST: creating comments and replies ───────────────────────────────────────

describe('POST /api/articles/[id]/comments authorization and validation', () => {
  it('lets a writer start a top-level comment thread on their own article', async () => {
    // Documented decision: writers may open threads on their own drafts (for
    // questions to editors), not just reply.
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    const res = await POST(jsonReq({ commentText: 'Is this section too long?' }), params())
    expect(res.status).toBe(201)
  })

  it('lets a writer reply on their own article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    prismaMock.articleComment.findUnique.mockResolvedValue(baseComment)
    const res = await POST(
      jsonReq({ commentText: 'Will fix, thanks.', parentId: 'comment-1' }),
      params()
    )
    expect(res.status).toBe(201)
  })

  it('blocks a writer from commenting on someone else\'s article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OTHER_WRITER)
    const res = await POST(jsonReq({ commentText: 'Sneaky' }), params())
    expect(res.status).toBe(403)
    expect(prismaMock.articleComment.create).not.toHaveBeenCalled()
  })

  it('rejects replying to a reply (threads stay one level deep)', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.articleComment.findUnique.mockResolvedValue({ ...baseComment, parentId: 'root-1' })
    const res = await POST(jsonReq({ commentText: 'Nested', parentId: 'comment-1' }), params())
    expect(res.status).toBe(400)
  })

  it('rejects a parent comment that belongs to a different article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.articleComment.findUnique.mockResolvedValue({ ...baseComment, articleId: 'article-other' })
    const res = await POST(jsonReq({ commentText: 'Cross-wired', parentId: 'comment-1' }), params())
    expect(res.status).toBe(400)
  })

  it('rejects empty comments and invalid selections', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    expect((await POST(jsonReq({ commentText: '   ' }), params())).status).toBe(400)
    expect((await POST(jsonReq({ commentText: 'ok', tiptapFrom: 10, tiptapTo: 4 }), params())).status).toBe(400)
    expect((await POST(jsonReq({ commentText: 'ok', tiptapFrom: -2, tiptapTo: 4 }), params())).status).toBe(400)
  })

  it('rejects a zero-length selection (to must be greater than from)', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    const res = await POST(jsonReq({ commentText: 'ok', tiptapFrom: 5, tiptapTo: 5 }), params())
    expect(res.status).toBe(400)
    expect(prismaMock.articleComment.create).not.toHaveBeenCalled()
  })

  it('rejects non-integer selection positions', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    const res = await POST(jsonReq({ commentText: 'ok', tiptapFrom: 1.5, tiptapTo: 4 }), params())
    expect(res.status).toBe(400)
    expect(prismaMock.articleComment.create).not.toHaveBeenCalled()
  })
})

// ── POST: notifications ───────────────────────────────────────────────────────

describe('comment notifications', () => {
  it('notifies the article author when an editor opens a new thread', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(EDITOR)
    await POST(jsonReq({ commentText: 'Please revise the intro.' }), params())
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'writer-1', type: 'comment', articleId: 'article-1' }),
      })
    )
  })

  it('does not notify anyone of their own actions', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    await POST(jsonReq({ commentText: 'Note to self' }), params())
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
  })

  it('notifies thread participants of a reply, excluding the replier', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    prismaMock.articleComment.findUnique.mockResolvedValue(baseComment) // root by editor-1
    prismaMock.articleComment.findMany.mockResolvedValue([{ authorId: 'admin-1' }])
    await POST(jsonReq({ commentText: 'Done.', parentId: 'comment-1' }), params())
    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1)
    const recipients = prismaMock.notification.createMany.mock.calls[0][0].data.map(
      (n: { userId: string }) => n.userId
    )
    expect(recipients.sort()).toEqual(['admin-1', 'editor-1'])
  })

  it('stops notifying once the thread is resolved', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    prismaMock.articleComment.findUnique.mockResolvedValue({ ...baseComment, resolved: true })
    const res = await POST(jsonReq({ commentText: 'Late reply', parentId: 'comment-1' }), params())
    expect(res.status).toBe(201)
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
  })
})

// ── PATCH: resolve, reopen, and edit permissions ──────────────────────────────

describe('PATCH /api/articles/[id]/comments/[commentId] permissions', () => {
  beforeEach(() => {
    prismaMock.articleComment.findUnique.mockResolvedValue({
      ...baseComment,
      author: { name: 'Ed', email: 'ed@test' },
    })
    prismaMock.articleComment.update.mockResolvedValue({ ...baseComment, resolved: true })
  })

  const patchReq = (body: unknown) =>
    new Request('http://localhost/api/articles/article-1/comments/comment-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('lets the article author (writer) resolve and reopen threads', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OWNER_WRITER)
    const res = await PATCH(patchReq({ resolved: true }), patchParams())
    expect(res.status).toBe(200)
  })

  it('lets editors resolve threads', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(EDITOR)
    const res = await PATCH(patchReq({ resolved: true }), patchParams())
    expect(res.status).toBe(200)
  })

  it('blocks editing someone else\'s comment text', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN) // comment author is editor-1
    const res = await PATCH(patchReq({ commentText: 'Rewritten' }), patchParams())
    expect(res.status).toBe(403)
  })

  it('404s when the comment belongs to a different article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.articleComment.findUnique.mockResolvedValue({
      ...baseComment,
      articleId: 'article-other',
      author: { name: 'Ed', email: 'ed@test' },
    })
    const res = await PATCH(patchReq({ resolved: true }), patchParams())
    expect(res.status).toBe(404)
  })

  it('denies writers who do not own the article', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(OTHER_WRITER)
    const res = await PATCH(patchReq({ resolved: true }), patchParams())
    expect(res.status).toBe(403)
  })
})
