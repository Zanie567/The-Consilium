/**
 * In-process resilience tests for the comment route handlers — the fix for the
 * launch-blocking 503s. With prisma mocked to THROW (simulating the connection
 * pool failing to hand out a connection under load), the handlers must return a
 * controlled, well-shaped JSON payload rather than letting the error escape as
 * an unhandled 503/500. On the happy path they return 200 with the right shape.
 *
 * No server or database required — runs on every `npm test`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, authMock, sessionMock } = vi.hoisted(() => ({
  prismaMock: {
    comment: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
  authMock: { getVerifiedSessionUser: vi.fn(), authOptions: {} },
  sessionMock: { getServerSession: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('next-auth', () => sessionMock)

import { GET as commentsGET } from '@/app/api/comments/route'
import { GET as editorialCommentsGET } from '@/app/api/editorial/comments/route'

const MODERATOR = { id: 'mod-1', role: 'ADMIN', name: 'Mod', email: 'mod@consilium.test' }

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.getServerSession.mockResolvedValue(null)
  authMock.getVerifiedSessionUser.mockResolvedValue(MODERATOR)
})

// ── GET /api/comments (article threads) ──────────────────────────────────────

describe('GET /api/comments resilience', () => {
  const req = (articleId?: string) =>
    new Request(`http://localhost/api/comments${articleId ? `?articleId=${articleId}` : ''}`)

  it('happy path → 200 with {comments,total}', async () => {
    prismaMock.comment.findMany.mockResolvedValue([{ id: 'c1' }])
    prismaMock.comment.count.mockResolvedValue(1)
    const res = await commentsGET(req('a1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.comments).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('DB failure → controlled response (NOT an unhandled crash), still parseable', async () => {
    prismaMock.comment.findMany.mockRejectedValue(new Error('pool: connection timeout'))
    prismaMock.comment.count.mockRejectedValue(new Error('pool: connection timeout'))
    // Must not throw out of the handler.
    const res = await commentsGET(req('a1'))
    expect(res.status).toBeGreaterThanOrEqual(500)
    const body = await res.json()
    // Front-end can still render an empty/error state from this shape.
    expect(body).toMatchObject({ comments: [], total: 0 })
    expect(body.error).toBeTruthy()
  })

  it('missing articleId → 400 (validation before any DB access)', async () => {
    const res = await commentsGET(req())
    expect(res.status).toBe(400)
    expect(prismaMock.comment.findMany).not.toHaveBeenCalled()
  })
})

// ── GET /api/editorial/comments (moderation) ─────────────────────────────────

describe('GET /api/editorial/comments resilience', () => {
  const req = (tab = 'reported') =>
    new Request(`http://localhost/api/editorial/comments?tab=${tab}&page=0`)

  it('happy path → 200 with comments + stats', async () => {
    prismaMock.comment.findMany.mockResolvedValue([])
    prismaMock.comment.count
      .mockResolvedValueOnce(2) // reported
      .mockResolvedValueOnce(1) // hidden
      .mockResolvedValueOnce(7) // total
    const res = await editorialCommentsGET(req('reported'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats).toEqual({ total: 7, reported: 2, hidden: 1 })
    expect(body.total).toBe(2) // reported tab total derived from stats
  })

  it('unauthorised caller → 401 (no DB access)', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await editorialCommentsGET(req())
    expect(res.status).toBe(401)
    expect(prismaMock.comment.findMany).not.toHaveBeenCalled()
  })

  it('DB failure → controlled 503 with zeroed stats (NOT a crash)', async () => {
    prismaMock.comment.findMany.mockRejectedValue(new Error('pool exhausted'))
    prismaMock.comment.count.mockRejectedValue(new Error('pool exhausted'))
    const res = await editorialCommentsGET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toMatchObject({
      comments: [],
      total: 0,
      stats: { total: 0, reported: 0, hidden: 0 },
    })
  })

  it('uses 4 queries, not the old 6 (no wasted aggregate)', async () => {
    prismaMock.comment.findMany.mockResolvedValue([])
    prismaMock.comment.count.mockResolvedValue(0)
    await editorialCommentsGET(req('recent'))
    // 1 findMany + 3 counts (reported/hidden/total). The redundant per-tab count
    // and the unused aggregate were removed to cut connection pressure.
    expect(prismaMock.comment.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.comment.count).toHaveBeenCalledTimes(3)
    expect(prismaMock.comment.aggregate).not.toHaveBeenCalled()
  })
})
