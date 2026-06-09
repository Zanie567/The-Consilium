/**
 * In-process route-handler tests for the article scheduling flow.
 *
 * Same pattern as route-handlers.test.ts: the App Router handlers are imported
 * directly with mocked `prisma` / auth / email collaborators, so these run on
 * every `npm test` without a server or database.
 *
 * Regression coverage for two scheduling bugs found in the June 2026 audit:
 *  - PUT /api/articles/[id] accepted status=SCHEDULED with no scheduledAt,
 *    leaving the article in a limbo state the publish cron never picks up.
 *  - PATCH /api/editorial/calendar accepted a drag-move onto a past day,
 *    which made the publish cron publish the article on its next run.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, authMock } = vi.hoisted(() => {
  return {
    prismaMock: {
      article: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      categoryEditor: { findFirst: vi.fn(), findMany: vi.fn() },
      articleTag: { deleteMany: vi.fn(), createMany: vi.fn() },
      tag: { upsert: vi.fn() },
      notification: { create: vi.fn(), createMany: vi.fn() },
      user: { findMany: vi.fn() },
    },
    authMock: {
      authOptions: {},
      getVerifiedSessionUser: vi.fn(),
      requireActiveSession: vi.fn(),
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(() => Promise.resolve()),
  articleSubmittedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  articleReturnedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  articlePublishedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: vi.fn() }))

import { PUT as articlePUT } from '@/app/api/articles/[id]/route'
import { PATCH as calendarPATCH } from '@/app/api/editorial/calendar/route'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Ada', email: 'ada@consilium.test' }
const WRITER = { id: 'writer-1', role: 'WRITER', name: 'Wes', email: 'wes@consilium.test' }

const baseArticle = {
  id: 'article-1',
  title: 'Test',
  slug: 'test',
  status: 'DRAFT',
  scheduledAt: null as Date | null,
  publishedAt: null as Date | null,
  deletedAt: null,
  authorId: WRITER.id,
  categoryId: null,
  editorNote: null,
  author: { id: WRITER.id, name: 'Wes', email: WRITER.email },
  category: null,
}

function putRequest(body: unknown): NextRequest {
  return new NextRequest('http://test.local/api/articles/article-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function articleParams() {
  return { params: Promise.resolve({ id: 'article-1' }) }
}

function calendarRequest(body: unknown): Request {
  return new Request('http://test.local/api/editorial/calendar', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.article.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...baseArticle, ...data })
  )
})

describe('PUT /api/articles/[id] scheduling validation', () => {
  it('rejects SCHEDULED with no scheduledAt and none stored (limbo guard)', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue({ ...baseArticle })

    const res = await articlePUT(putRequest({ status: 'SCHEDULED' }), articleParams())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/publish date and time is required/i)
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('rejects SCHEDULED with a past scheduledAt', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue({ ...baseArticle })

    const res = await articlePUT(
      putRequest({ status: 'SCHEDULED', scheduledAt: '2020-01-01T09:00' }),
      articleParams()
    )
    expect(res.status).toBe(400)
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('rejects SCHEDULED with an unparseable scheduledAt', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue({ ...baseArticle })

    const res = await articlePUT(
      putRequest({ status: 'SCHEDULED', scheduledAt: 'not-a-date' }),
      articleParams()
    )
    expect(res.status).toBe(400)
  })

  it('accepts SCHEDULED with a valid future scheduledAt', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue({ ...baseArticle })

    const res = await articlePUT(
      putRequest({ status: 'SCHEDULED', scheduledAt: '2099-06-15T09:00' }),
      articleParams()
    )
    expect(res.status).toBe(200)
    const data = prismaMock.article.update.mock.calls[0][0].data
    expect(data.status).toBe('SCHEDULED')
    // 09:00 UK in June is BST (UTC+1) → 08:00 UTC
    expect((data.scheduledAt as Date).toISOString()).toBe('2099-06-15T08:00:00.000Z')
  })

  it('keeps the stored schedule when SCHEDULED is re-saved without scheduledAt (autosave)', async () => {
    const stored = new Date('2099-06-15T08:00:00.000Z')
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue({
      ...baseArticle,
      status: 'SCHEDULED',
      scheduledAt: stored,
    })

    const res = await articlePUT(putRequest({ status: 'SCHEDULED', title: 'Edited' }), articleParams())
    expect(res.status).toBe(200)
    const data = prismaMock.article.update.mock.calls[0][0].data
    expect(data.scheduledAt).toBe(stored)
  })

  it('clears scheduledAt when a scheduled article is moved back to DRAFT', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue({
      ...baseArticle,
      status: 'SCHEDULED',
      scheduledAt: new Date('2099-06-15T08:00:00.000Z'),
    })

    const res = await articlePUT(putRequest({ status: 'DRAFT' }), articleParams())
    expect(res.status).toBe(200)
    const data = prismaMock.article.update.mock.calls[0][0].data
    expect(data.status).toBe('DRAFT')
    expect(data.scheduledAt).toBeNull()
  })

  it('ignores a WRITER attempt to set status=SCHEDULED on their own draft', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(WRITER)
    prismaMock.article.findUnique.mockResolvedValue({ ...baseArticle })

    const res = await articlePUT(
      putRequest({ status: 'SCHEDULED', scheduledAt: '2099-06-15T09:00' }),
      articleParams()
    )
    expect(res.status).toBe(200)
    const data = prismaMock.article.update.mock.calls[0][0].data
    expect(data.status).toBe('DRAFT')
    expect(data.scheduledAt).toBeNull()
  })
})

describe('PATCH /api/editorial/calendar past-day guard', () => {
  const scheduled = {
    id: 'article-1',
    status: 'SCHEDULED',
    scheduledAt: new Date('2099-06-15T08:00:00.000Z'),
    deletedAt: null,
  }

  it('rejects a move that lands the article in the past', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue(scheduled)

    const res = await calendarPATCH(calendarRequest({ articleId: 'article-1', date: '2020-01-01' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/in the past/i)
    expect(prismaMock.article.updateMany).not.toHaveBeenCalled()
  })

  it('accepts a move to a future day, preserving the wall-clock time', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue(scheduled)
    prismaMock.article.updateMany.mockResolvedValue({ count: 1 })

    const res = await calendarPATCH(calendarRequest({ articleId: 'article-1', date: '2099-06-20' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // 09:00 UK wall-clock preserved on the new June day (BST → 08:00 UTC)
    expect(body.scheduledAt).toBe('2099-06-20T08:00:00.000Z')
  })

  it('returns 409 when the article changed underneath the move (CAS)', async () => {
    authMock.getVerifiedSessionUser.mockResolvedValue(ADMIN)
    prismaMock.article.findUnique.mockResolvedValue(scheduled)
    prismaMock.article.updateMany.mockResolvedValue({ count: 0 })

    const res = await calendarPATCH(calendarRequest({ articleId: 'article-1', date: '2099-06-20' }))
    expect(res.status).toBe(409)
  })
})
