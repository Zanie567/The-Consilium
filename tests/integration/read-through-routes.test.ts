/**
 * In-process route-handler tests for the read-through endpoints, following
 * route-handlers.test.ts: handlers imported directly, prisma and auth mocked.
 * These pin the ownership rules: a writer can never read another writer's
 * per-article breakdown, while ADMIN may view anyone's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, authMock } = vi.hoisted(() => ({
  prismaMock: {
    article: { findUnique: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  authMock: { getVerifiedSessionUser: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)

import { GET as listGET } from '@/app/api/editorial/read-through/route'
import { GET as detailGET } from '@/app/api/editorial/read-through/[articleId]/route'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Ada', email: 'ada@consilium.test' }
const WRITER_A = { id: 'writer-a', role: 'WRITER', name: 'Alice', email: 'alice@consilium.test' }

const ARTICLE_BY_B = {
  id: 'article-b1',
  title: 'B article',
  slug: 'b-article',
  authorId: 'writer-b',
  status: 'PUBLISHED',
  deletedAt: null,
  publishedAt: new Date('2026-01-01'),
  viewCount: 10,
}

// One aggregate row as the raw SQL would return it (8 readers, cliff at 40-50).
const RAW_DETAIL_ROW = {
  readerCount: 8,
  completedCount: 2,
  medianProgress: 45,
  past10: 8, past20: 8, past30: 7, past40: 7, past50: 4,
  past60: 4, past70: 3, past80: 2, past90: 2, past100: 1,
}

const detail = (articleId: string) =>
  detailGET(new NextRequest(`http://localhost/api/editorial/read-through/${articleId}`), {
    params: Promise.resolve({ articleId }),
  })
const list = (qs = '') =>
  listGET(new NextRequest(`http://localhost/api/editorial/read-through${qs}`))

beforeEach(() => vi.clearAllMocks())

describe('GET /api/editorial/read-through/[articleId] (ownership)', () => {
  it('returns 401 when there is no verified session', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await detail('article-b1')
    expect(res.status).toBe(401)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it("writer A asking for writer B's article gets 404 and no aggregation runs", async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findUnique.mockResolvedValue(ARTICLE_BY_B)
    const res = await detail('article-b1')
    expect(res.status).toBe(404)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('a missing article and a foreign article are indistinguishable (both 404)', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findUnique.mockResolvedValue(null)
    const missing = await detail('nope')

    prismaMock.article.findUnique.mockResolvedValue(ARTICLE_BY_B)
    const foreign = await detail('article-b1')

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(await missing.json()).toEqual(await foreign.json())
  })

  it('an unpublished article 404s even for its owner', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findUnique.mockResolvedValue({
      ...ARTICLE_BY_B,
      authorId: WRITER_A.id,
      status: 'DRAFT',
    })
    const res = await detail('article-b1')
    expect(res.status).toBe(404)
  })

  it('the owner gets their own breakdown', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findUnique.mockResolvedValue({ ...ARTICLE_BY_B, authorId: WRITER_A.id })
    prismaMock.$queryRaw.mockResolvedValue([RAW_DETAIL_ROW])
    const res = await detail('article-b1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.readerCount).toBe(8)
    expect(body.stats.hasEnoughData).toBe(true)
    expect(body.stats.completionRate).toBe(25)
    expect(body.stats.steepestDrop).toEqual({ from: 40, to: 50, readersLost: 3, lostShare: 38 })
  })

  it("ADMIN may view another writer's breakdown", async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue(ARTICLE_BY_B)
    prismaMock.$queryRaw.mockResolvedValue([RAW_DETAIL_ROW])
    const res = await detail('article-b1')
    expect(res.status).toBe(200)
  })

  it('below the 5-reader minimum the response carries no distribution', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findUnique.mockResolvedValue({ ...ARTICLE_BY_B, authorId: WRITER_A.id })
    prismaMock.$queryRaw.mockResolvedValue([
      { ...RAW_DETAIL_ROW, readerCount: 3, completedCount: 1 },
    ])
    const res = await detail('article-b1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats).toEqual({
      readerCount: 3,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
      retention: null,
      steepestDrop: null,
    })
  })
})

describe('GET /api/editorial/read-through (list ownership)', () => {
  it('returns 401 when there is no verified session', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(null)
    const res = await list()
    expect(res.status).toBe(401)
  })

  it("a writer requesting another author's list gets 403 before any query", async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    const res = await list('?authorId=writer-b')
    expect(res.status).toBe(403)
    expect(prismaMock.article.findMany).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('a writer with no authorId param gets their own published articles', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findMany.mockResolvedValue([])
    const res = await list()
    expect(res.status).toBe(200)
    expect(prismaMock.article.findMany.mock.calls[0][0].where).toMatchObject({
      authorId: WRITER_A.id,
      status: 'PUBLISHED',
      deletedAt: null,
    })
  })

  it("ADMIN may request another author's list", async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findMany.mockResolvedValue([])
    const res = await list('?authorId=writer-b')
    expect(res.status).toBe(200)
    expect(prismaMock.article.findMany.mock.calls[0][0].where).toMatchObject({
      authorId: 'writer-b',
    })
  })

  it('articles with no progress rows fall back to the zero-reader state', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER_A)
    prismaMock.article.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'My piece',
        slug: 'my-piece',
        publishedAt: new Date('2026-02-02'),
        viewCount: 4,
      },
    ])
    prismaMock.$queryRaw.mockResolvedValue([])
    const res = await list()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.articles).toHaveLength(1)
    expect(body.articles[0]).toMatchObject({
      id: 'a1',
      readerCount: 0,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
    })
  })
})
