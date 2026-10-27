import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, verifiedUser, consentedAudience } = vi.hoisted(() => ({
  verifiedUser: vi.fn(),
  consentedAudience: vi.fn(),
  prismaMock: {
    articleView: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    article: { count: vi.fn(), findMany: vi.fn() },
    subscriber: { count: vi.fn(), findMany: vi.fn() },
    siteView: { count: vi.fn(), groupBy: vi.fn() },
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
  prismaMock.siteView.groupBy.mockResolvedValue([])
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
      { source: null, referrer: 'https://theconsilium.co.uk/', _count: { _all: 1 } },
    ])
    prismaMock.siteView.groupBy.mockResolvedValueOnce([
      { referrer: 'https://www.linkedin.com/', _count: { _all: 2 } },
      { referrer: null, _count: { _all: 1 } },
    ])
    const response = await get('distribution', '7d')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.trafficSources).toEqual([
      { source: 'Direct / unknown', views: 3, pct: 21 },
      { source: 'Internal', views: 1, pct: 7 },
      { source: 'Search', views: 5, pct: 36 },
      { source: 'Social', views: 5, pct: 36 },
    ])
    expect(data.topReferrers).toEqual([
      { source: 'Google', views: 5 },
      { source: 'Instagram', views: 3 },
      { source: 'LinkedIn', views: 2 },
    ])
    const query = prismaMock.articleView.groupBy.mock.calls[0][0]
    expect(query.where.viewedAt.gte).toBeInstanceOf(Date)
    expect(query.by).toEqual(['source', 'referrer', 'entryKind', 'campaignSource', 'campaignMedium'])
    expect(query._count).toEqual({ _all: true })
    const pagesQuery = prismaMock.siteView.groupBy.mock.calls[0][0]
    expect(pagesQuery.by).toEqual(['referrer', 'entryKind', 'campaignSource', 'campaignMedium'])
    expect(pagesQuery.where.viewedAt.gte).toBeInstanceOf(Date)
    expect(prismaMock.articleView.findMany).not.toHaveBeenCalled()
  })

  it('reports tagged landing views from articles and public pages without counting internal navigation', async () => {
    prismaMock.articleView.groupBy
      .mockResolvedValueOnce([]) // source distribution
      .mockResolvedValueOnce([{
        campaignName:'launch',campaignSource:'instagram',campaignMedium:'social',
        campaignContent:'story_1',_count:{_all:3},
      }])
      .mockResolvedValueOnce([
        {articleId:'article-1',source:null,referrer:null,entryKind:'entry',
         campaignSource:'instagram',campaignMedium:'social',_count:{_all:3}},
        {articleId:'article-1',source:null,referrer:null,entryKind:'internal',
         campaignSource:null,campaignMedium:null,_count:{_all:2}},
      ])
    prismaMock.siteView.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        campaignName:'launch',campaignSource:'instagram',campaignMedium:'social',
        campaignContent:'story_1',_count:{_all:1},
      }])
    prismaMock.article.findMany.mockResolvedValueOnce([{
      id:'article-1',title:'Test article',slug:'test-article',
      publishedAt:new Date(),viewCount:5,author:{name:'Editor'},category:null,
    }])
    const response = await get('distribution')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.taggedLandings).toBe(4)
    expect(data.campaigns).toEqual([{
      campaign:'launch',source:'instagram',medium:'social',content:'story_1',landings:4,
    }])
    expect(data.articleSourcePerformance[0]).toMatchObject({
      id:'article-1',views:5,knownLandings:3,social:3,internal:2,
    })
  })

  it('keeps distribution analytics restricted to authorised users', async () => {
    verifiedUser.mockResolvedValueOnce(null)
    const response = await get('distribution')
    expect(response.status).toBe(401)
    expect(prismaMock.articleView.groupBy).not.toHaveBeenCalled()
    expect(prismaMock.siteView.groupBy).not.toHaveBeenCalled()
  })
})
