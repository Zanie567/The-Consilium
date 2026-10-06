import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  query: vi.fn(), users: vi.fn(), total: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getVerifiedSessionUser: vi.fn(async () => ({ id: 'admin', role: 'ADMIN' })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, user: { findMany: mocks.users, count: mocks.total } } }))
import { GET } from '@/app/api/admin/users/route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue([{ id: 'older-high-count' }, { id: 'newer-low-count' }])
  mocks.total.mockResolvedValue(16)
  mocks.users.mockImplementation(async args => args.where.id ? [
    { id: 'newer-low-count', _count: { articles: 1, comments: 1 } },
    { id: 'older-high-count', _count: { articles: 5, comments: 5 } },
  ] : [{ id: 'newer-low-count', _count: { articles: 1, comments: 1 } }])
})
it.each(['articleCount', 'commentCount'])('globally ranks %s before pagination rather than sorting the current page', async sort => {
  const response = await GET(new NextRequest(`http://localhost/api/admin/users?sort=${sort}&limit=15`))
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.users[0].id).toBe('older-high-count')
  expect(result.total).toBe(16)
  expect(result.pages).toBe(2)
})
it('keeps search input bound as a value rather than SQL', async () => {
  const search = "x' OR TRUE --"
  const response = await GET(new NextRequest(`http://localhost/api/admin/users?sort=articleCount&search=${encodeURIComponent(search)}&role=READER&status=warned`))
  expect(response.status).toBe(200)
  const sql = mocks.query.mock.calls[0][0]
  expect(sql.text).not.toContain(search)
  expect(sql.values).toContain(`%${search}%`)
  expect(sql.values).toContain('READER')
})
