/**
 * Regression coverage for the September 2026 publication-pipeline audit
 * finding: POST /api/articles let an admin/editor create an article with
 * status=SCHEDULED and no scheduledAt, leaving it in limbo forever (the
 * publish cron only ever looks at SCHEDULED rows with a past scheduledAt).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, authMock } = vi.hoisted(() => ({
  prismaMock: {
    article: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    articleTag: { createMany: vi.fn() },
    tag: { upsert: vi.fn() },
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

import { POST } from '@/app/api/articles/route'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Ada', email: 'ada@consilium.test' }

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://test.local/api/articles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'A new article',
      content: '{}',
      ...body,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })
  prismaMock.article.findUnique.mockResolvedValue(null)
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock)
  )
})

describe('POST /api/articles — SCHEDULED creation must carry a scheduledAt', () => {
  it('rejects status=SCHEDULED with no scheduledAt', async () => {
    const res = await POST(postRequest({ status: 'SCHEDULED' }))

    expect(res.status).toBe(400)
    expect(prismaMock.article.create).not.toHaveBeenCalled()
  })

  it('rejects status=SCHEDULED with a past scheduledAt', async () => {
    const res = await POST(postRequest({ status: 'SCHEDULED', scheduledAt: '2020-01-01T09:00' }))

    expect(res.status).toBe(400)
    expect(prismaMock.article.create).not.toHaveBeenCalled()
  })

  it('creates SCHEDULED with a valid future scheduledAt and persists it', async () => {
    prismaMock.article.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'article-1', ...data })
    )

    const res = await POST(postRequest({ status: 'SCHEDULED', scheduledAt: '2099-06-15T09:00' }))

    expect(res.status).toBe(201)
    const created = prismaMock.article.create.mock.calls[0][0].data
    expect(created.status).toBe('SCHEDULED')
    expect(created.scheduledAt).toBeInstanceOf(Date)
  })
})
