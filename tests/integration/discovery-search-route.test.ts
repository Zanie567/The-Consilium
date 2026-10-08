import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const db = vi.hoisted(() => ({ article: { findMany: vi.fn() }, user: { findMany: vi.fn() }, tag: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'local' }))
import { GET } from '@/app/api/search/route'
const request = (query: string) => new NextRequest(`http://localhost/api/search?${query}`)
beforeEach(() => { vi.clearAllMocks(); db.article.findMany.mockResolvedValue([]); db.user.findMany.mockResolvedValue([]); db.tag.findMany.mockResolvedValue([]) })
describe('bounded public discovery search', () => {
  it.each(['', 'q=+', 'q=a', 'q=%00'])('does no database work for empty/short query %s', async q => {
    expect(await (await GET(request(q))).json()).toEqual([])
    expect(db.article.findMany).not.toHaveBeenCalled()
  })
  it('returns distinct article, author and topic groups with bounded metadata queries', async () => {
    db.article.findMany.mockResolvedValue([{ id: 'a', title: 'Finance', excerpt: 'Markets' }])
    db.user.findMany.mockResolvedValue([{ id: 'u', name: 'Finance Writer' }])
    db.tag.findMany.mockResolvedValue([{ id: 't', name: 'Finance' }])
    const result = await GET(request('q=finance&scope=all&page=999999'))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ articles: [{ id: 'a' }], authors: [{ id: 'u' }], topics: [{ id: 't' }], page: 500 })
    expect(db.article.findMany.mock.calls[0][0]).toMatchObject({ take: 16, skip: 499 * 15, where: { status: 'PUBLISHED', deletedAt: null } })
    expect(db.article.findMany.mock.calls[0][0].select).not.toHaveProperty('content')
    expect(db.tag.findMany.mock.calls[0][0].take).toBe(8)
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
  it('returns a real service error rather than a misleading no-results response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.article.findMany.mockRejectedValue(new Error('private database detail'))
    const res = await GET(request('q=finance&scope=all'))
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('private database detail')
    log.mockRestore()
  })
})
