import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { db, verifyUser, invalidate } = vi.hoisted(() => ({
  db: {
    article: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  verifyUser: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  requireActiveSession: vi.fn(),
  requireVerifiedSessionUser: verifyUser,
}))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: invalidate }))

import { POST } from '@/app/api/articles/route'
import { PATCH } from '@/app/api/editorial/trash/[id]/route'

beforeEach(() => {
  vi.clearAllMocks()
  verifyUser.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'ADMIN' } })
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db))
  db.article.updateMany.mockResolvedValue({ count: 1 })
})

describe('public visibility changes invalidate article lists after commit', () => {
  it.each(['DRAFT', 'PUBLISHED'] as const)('create %s refreshes only public content', async (status) => {
    db.article.findUnique.mockResolvedValue(null)
    db.article.create.mockResolvedValue({ id: 'new', status })
    const response = await POST(new NextRequest('http://localhost/api/articles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Article', content: '', status }),
    }))
    expect(response.status).toBe(201)
    expect(invalidate).toHaveBeenCalledTimes(status === 'PUBLISHED' ? 1 : 0)
    if (status === 'PUBLISHED') {
      expect(db.article.create.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0])
    }
  })

  it.each(['DRAFT', 'PUBLISHED'] as const)('restore %s refreshes only public content', async (status) => {
    db.article.findUnique
      .mockResolvedValueOnce({ id: 'old', status, deletedAt: new Date(), authorId: 'writer' })
      .mockResolvedValueOnce({ id: 'old', status, deletedAt: null })
    const response = await PATCH(new NextRequest('http://localhost/api/editorial/trash/old', {
      method: 'PATCH',
    }), { params: Promise.resolve({ id: 'old' }) })
    expect(response.status).toBe(200)
    expect(invalidate).toHaveBeenCalledTimes(status === 'PUBLISHED' ? 1 : 0)
    if (status === 'PUBLISHED') {
      expect(db.article.updateMany.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0])
    }
  })

  it('does not invalidate when a create rolls back', async () => {
    db.article.findUnique.mockResolvedValue(null)
    db.$transaction.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await POST(new NextRequest('http://localhost/api/articles', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Article', content: '', status: 'PUBLISHED' }),
    }))
    expect(response.status).toBe(500)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does not invalidate when a restore fails', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await PATCH(new NextRequest('http://localhost/api/editorial/trash/old', {
      method: 'PATCH',
    }), { params: Promise.resolve({ id: 'old' }) })
    expect(response.status).toBe(500)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does not restore or invalidate another writer’s article', async () => {
    verifyUser.mockResolvedValue({ ok: true, user: { id: 'writer-other', role: 'WRITER' } })
    db.article.findUnique.mockResolvedValue({ id: 'old', deletedAt: new Date(), authorId: 'writer' })
    const response = await PATCH(new NextRequest('http://localhost/api/editorial/trash/old', {
      method: 'PATCH',
    }), { params: Promise.resolve({ id: 'old' }) })
    expect(response.status).toBe(403)
    expect(db.article.updateMany).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
