import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, verifiedUser } = vi.hoisted(() => ({
  verifiedUser: vi.fn(),
  prismaMock: {
    articleView: { count: vi.fn(), findMany: vi.fn() },
    siteView: { count: vi.fn() },
    article: { count: vi.fn(), findMany: vi.fn() },
    subscriber: { count: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => ({ getVerifiedSessionUser: verifiedUser }))
vi.mock('@/lib/analyticsEngagement', () => ({
  readingEngagement: vi.fn(),
  consentedAudience: vi.fn(),
}))

import { GET } from '@/app/api/editorial/analytics/route'

beforeEach(() => {
  vi.clearAllMocks()
  verifiedUser.mockResolvedValue({ id: 'admin', role: 'ADMIN' })
  prismaMock.articleView.count
    .mockResolvedValueOnce(282)  // all historical article view records
    .mockResolvedValueOnce(244)  // selected period
    .mockResolvedValueOnce(5)    // previous period
    .mockResolvedValueOnce(182)  // since public launch
  prismaMock.articleView.findMany.mockResolvedValue([])
  prismaMock.article.count.mockResolvedValue(4)
  prismaMock.article.findMany.mockResolvedValue([])
  prismaMock.subscriber.count.mockResolvedValue(0)
  prismaMock.siteView.count
    .mockResolvedValueOnce(3)    // non-article public pages since launch
    .mockResolvedValueOnce(2)    // selected period
})

describe('editorial analytics overview consistency', () => {
  it('uses historical article records for all-time views, including soft-deleted articles, and counts public page views separately', async () => {
    const res = await GET(new NextRequest('http://localhost/api/editorial/analytics?period=30d&tab=overview'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toMatchObject({
      viewsInPeriod: 244,
      totalViews: 282,
      viewsSinceLaunch: 182,
      viewsBeforeLaunch: 100,
      siteViewsInPeriod: 246,
      siteViewsAllTime: 285,
      totalPublished: 4,
    })
    // The all-time number must not be a filtered sum of articles.viewCount.
    expect(prismaMock.articleView.count).toHaveBeenNthCalledWith(1)
    expect(prismaMock.siteView.count).toHaveBeenCalledTimes(2)
    // Historical pre-launch test records are not real site traffic.
    expect(prismaMock.siteView.count.mock.calls[0][0].where.viewedAt.gte)
      .toEqual(new Date('2026-10-27T14:30:00Z'))
  })

  it('refuses unauthorised requests before reading traffic data', async () => {
    verifiedUser.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/editorial/analytics?period=30d&tab=overview'))
    expect(res.status).toBe(401)
    expect(prismaMock.articleView.count).not.toHaveBeenCalled()
    expect(prismaMock.siteView.count).not.toHaveBeenCalled()
  })
})
