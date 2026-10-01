/**
 * Regression coverage for the September 2026 publication-pipeline audit
 * findings in PATCH /api/editorial/articles/[id]/review:
 *
 *  - BUG-1: the "published"/"returned" email must never be sent before the
 *    corresponding article mutation actually commits.
 *  - BUG-1 (false-failure half): once the article mutation has committed, a
 *    failure creating the in-app notification must never surface to the
 *    editor as a failed request.
 *  - New: the route must enforce legal source states server-side
 *    (approve/schedule/return only from PENDING_REVIEW; unpublish/correct
 *    only from PUBLISHED) and reject illegal transitions with a structured
 *    INVALID_STATUS_TRANSITION error before any write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, authMock, emailMock } = vi.hoisted(() => ({
  prismaMock: {
    article: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  authMock: {
    authOptions: {},
    requireVerifiedSessionUser: vi.fn(),
  },
  emailMock: {
    sendEmail: vi.fn(() => Promise.resolve()),
    articleReturnedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
    articlePublishedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/email', () => emailMock)
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: vi.fn() }))
vi.mock('@/lib/articleCategoryAccess', () => ({ loadEditorCategoryScope: vi.fn() }))
vi.mock('@/lib/articleCategoryScope', () => ({ editorCanAccessCategory: vi.fn(() => true) }))

import { PATCH } from '@/app/api/editorial/articles/[id]/review/route'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Ada', email: 'ada@consilium.test' }

function baseArticle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'article-1',
    title: 'Test article',
    slug: 'test-article',
    status: 'PENDING_REVIEW',
    scheduledAt: null,
    publishedAt: null,
    isFeatured: false,
    deletedAt: null,
    authorId: 'writer-1',
    categoryId: null,
    editorNote: null,
    corrected: false,
    correctionNote: null,
    author: { id: 'writer-1', name: 'Wes', email: 'wes@consilium.test' },
    ...overrides,
  }
}

function request(body: Record<string, unknown>): Request {
  return new Request('http://test.local/api/editorial/articles/article-1/review', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function params() {
  return { params: Promise.resolve({ id: 'article-1' }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock)
  )
})

describe('PATCH /api/editorial/articles/[id]/review — email must follow the commit', () => {
  it('never sends the published email before the article update commits', async () => {
    const order: string[] = []
    prismaMock.article.findUnique.mockResolvedValue(baseArticle())
    prismaMock.article.update.mockImplementation(async () => {
      order.push('db-commit')
      return baseArticle({ status: 'PUBLISHED' })
    })
    emailMock.sendEmail.mockImplementation(async () => {
      order.push('email-sent')
    })

    await PATCH(request({ action: 'approve' }), params())

    expect(order).toEqual(['db-commit', 'email-sent'])
  })

  it('never sends the returned email before the article update commits', async () => {
    const order: string[] = []
    prismaMock.article.findUnique.mockResolvedValue(baseArticle())
    prismaMock.article.update.mockImplementation(async () => {
      order.push('db-commit')
      return baseArticle({ status: 'REJECTED' })
    })
    emailMock.sendEmail.mockImplementation(async () => {
      order.push('email-sent')
    })

    await PATCH(request({ action: 'return', note: 'Needs sourcing' }), params())

    expect(order).toEqual(['db-commit', 'email-sent'])
  })

  it('does not send the published email at all when the underlying commit fails', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle())
    prismaMock.article.update.mockRejectedValue(new Error('connection dropped'))

    const res = await PATCH(request({ action: 'approve' }), params())

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/editorial/articles/[id]/review — mutation and notification commit atomically', () => {
  it('returns a structured error instead of throwing when the notification insert fails, and never reports success', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle())
    prismaMock.article.update.mockResolvedValue(baseArticle({ status: 'PUBLISHED' }))
    prismaMock.notification.create.mockRejectedValue(new Error('transient db error'))

    const res = await PATCH(request({ action: 'approve' }), params())

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })

  it('sends exactly one notification and one email when the approval succeeds', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle())
    prismaMock.article.update.mockResolvedValue(baseArticle({ status: 'PUBLISHED' }))
    prismaMock.notification.create.mockResolvedValue({ id: 'notif-1' })

    const res = await PATCH(request({ action: 'approve' }), params())

    expect(res.status).toBe(200)
    expect(prismaMock.notification.create).toHaveBeenCalledOnce()
    expect(emailMock.sendEmail).toHaveBeenCalledOnce()
  })
})

describe('PATCH /api/editorial/articles/[id]/review — server-side state-transition enforcement', () => {
  it('rejects approve when the article is not PENDING_REVIEW', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'DRAFT' }))

    const res = await PATCH(request({ action: 'approve' }), params())

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('rejects schedule when the article is not PENDING_REVIEW', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'PUBLISHED' }))

    const res = await PATCH(
      request({ action: 'schedule', scheduledAt: '2099-06-15T09:00' }),
      params()
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('rejects return when the article is not PENDING_REVIEW', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'DRAFT' }))

    const res = await PATCH(request({ action: 'return', note: 'no' }), params())

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('rejects unpublish when the article is not PUBLISHED', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'DRAFT' }))

    const res = await PATCH(request({ action: 'unpublish' }), params())

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('rejects correct when the article is not PUBLISHED', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'DRAFT' }))

    const res = await PATCH(
      request({ action: 'correct', corrected: true, correctionNote: 'typo' }),
      params()
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })

  it('allows approve from PENDING_REVIEW', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'PENDING_REVIEW' }))
    prismaMock.article.update.mockResolvedValue(baseArticle({ status: 'PUBLISHED' }))

    const res = await PATCH(request({ action: 'approve' }), params())

    expect(res.status).toBe(200)
    expect(prismaMock.article.update).toHaveBeenCalledOnce()
  })

  it('allows unpublish from PUBLISHED', async () => {
    prismaMock.article.findUnique.mockResolvedValue(baseArticle({ status: 'PUBLISHED' }))
    prismaMock.article.update.mockResolvedValue(baseArticle({ status: 'DRAFT' }))

    const res = await PATCH(request({ action: 'unpublish' }), params())

    expect(res.status).toBe(200)
    expect(prismaMock.article.update).toHaveBeenCalledOnce()
  })
})
