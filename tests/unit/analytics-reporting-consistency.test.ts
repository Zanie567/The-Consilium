import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, verifiedUser, consentedAudience } = vi.hoisted(() => ({
  verifiedUser: vi.fn(),
  consentedAudience: vi.fn(),
  prismaMock: {
    articleView: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    article: { count: vi.fn(), findMany: vi.fn() },
    subscriber: { count: vi.fn(), findMany: vi.fn() },
    siteView: { count: vi.fn() },
    bookmark: { groupBy: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => ({ getVerifiedSessionUser: verifiedUser }))
vi.mock('@/lib/analyticsEngagement', () => ({
  consentedAudience,
  readingEngagement: vi.fn(),
}))
import { GET } from '@/app/api/editorial/analytics/route'

const get = async (tab: string, period = '30d') =>
  GET(new NextRequest(`http://localhost/api/editorial/analytics?tab=${tab}&period=${period}`))

beforeEach(() => {
  vi.clearAllMocks()
  verifiedUser.mockResolvedValue({ id: 'admin', role: 'ADMIN' })
  consentedAudience.mockResolvedValue({ readers: 0, returning: 0 })
  prismaMock.articleView.count.mockResolvedValue(0)
  prismaMock.articleView.findMany.mockResolvedValue([])
  prismaMock.articleView.groupBy.mockResolvedValue([])
  prismaMock.article.count.mockResolvedValue(4)
  prismaMock.article.findMany.mockResolvedValue([])
  prismaMock.subscriber.count.mockResolvedValue(0)
  prismaMock.subscriber.findMany.mockResolvedValue([])
  prismaMock.siteView.count.mockResolvedValue(0)
  prismaMock.bookmark.groupBy.mockResolvedValue([])
})

describe('analytics reporting uses consistent periods and consent states', () => {
  it('compares active confirmed subscribers in both overview periods', async () => {
    const response = await get('overview')
    expect(response.status).toBe(200)
    const calls = prismaMock.subscriber.count.mock.calls.map(call => call[0].where)
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({ status: 'ACTIVE' })
    expect(calls[1].status).toBe('ACTIVE')
    expect(calls[1].confirmedAt.gte).toBeInstanceOf(Date)
    expect(calls[2].status).toBe('ACTIVE')
    expect(calls[2].confirmedAt.gte).toBeInstanceOf(Date)
    expect(calls[2].confirmedAt.lt).toBeInstanceOf(Date)
    expect(calls[2].subscribedAt).toBeUndefined()
  })

  it('counts only active confirmed subscriptions in the 12-week chart', async () => {
    const confirmedAt = new Date()
    prismaMock.subscriber.findMany.mockResolvedValueOnce([{ confirmedAt }])
    const response = await get('audience')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.subscriberGrowth.reduce((sum: number, w: {count:number}) => sum + w.count, 0)).toBe(1)
    const query = prismaMock.subscriber.findMany.mock.calls[0][0]
    expect(query.where.status).toBe('ACTIVE')
    expect(query.where.confirmedAt.gte).toBeInstanceOf(Date)
    expect(query.select).toEqual({ confirmedAt: true })
  })

  it('uses the selected period and historical referrers in traffic sources', async () => {
    prismaMock.articleView.groupBy.mockResolvedValueOnce([
      { source: null, referrer: 'https://www.google.com/', _count: { _all: 5 } },
      { source: null, referrer: 'https://l.instagram.com', _count: { _all: 3 } },
      { source: null, referrer: null, _count: { _all: 2 } },
    ])
    const response = await get('distribution', '7d')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.trafficSources).toEqual([
      { source: 'Direct / unknown', views: 2, pct: 20 },
      { source: 'Search', views: 5, pct: 50 },
      { source: 'Social', views: 3, pct: 30 },
    ])
    const query = prismaMock.articleView.groupBy.mock.calls[0][0]
    expect(query.where.viewedAt.gte).toBeInstanceOf(Date)
    expect(query.by).toEqual(['source', 'referrer'])
    expect(query._count).toEqual({ _all: true })
    expect(prismaMock.articleView.findMany).not.toHaveBeenCalled()
  })

  it('keeps distribution analytics restricted to authorised users', async () => {
    verifiedUser.mockResolvedValueOnce(null)
    const response = await get('distribution')
    expect(response.status).toBe(401)
    expect(prismaMock.articleView.groupBy).not.toHaveBeenCalled()
  })
})
