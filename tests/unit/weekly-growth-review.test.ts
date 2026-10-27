import { beforeEach, describe, expect, it, vi } from 'vitest'
const prismaMock = vi.hoisted(() => ({
  articleView: {count:vi.fn(),groupBy:vi.fn()},
  siteView: {count:vi.fn()},
  subscriber: {count:vi.fn()},
  article: {findMany:vi.fn()},
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
import { getWeeklyGrowthReview, growthDelta } from '@/lib/weeklyGrowthReview'

beforeEach(()=>{
  vi.clearAllMocks()
  prismaMock.articleView.count
    .mockResolvedValueOnce(40).mockResolvedValueOnce(20).mockResolvedValueOnce(3)
  prismaMock.siteView.count
    .mockResolvedValueOnce(10).mockResolvedValueOnce(5).mockResolvedValueOnce(2)
  prismaMock.subscriber.count
    .mockResolvedValueOnce(1).mockResolvedValueOnce(0)
  prismaMock.articleView.groupBy.mockResolvedValue([
    { articleId:'a', _count:{ _all:25 } },
  ])
  prismaMock.article.findMany.mockResolvedValue([{id:'a',title:'Test article',slug:'test-article'}])
})

describe('weekly editorial growth reporting',()=>{
  it('counts two completed weeks, tagged arrivals and active confirmations', async()=>{
    const review = await getWeeklyGrowthReview(new Date('2026-11-20T14:30:00Z'))
    expect(review.startDate).toBe('2026-11-13')
    expect(review.endDate).toBe('2026-11-19')
    expect(review.current).toMatchObject({
      articleViews:40,sitePageViews:50,taggedLandings:5,newConfirmedActiveSubscribers:1,
    })
    expect(review.changes).toMatchObject({ articleViews:100,sitePageViews:100,subscribers:null })
    expect(review.topArticles[0]).toEqual({id:'a',title:'Test article',slug:'test-article',views:25})
    const query=prismaMock.articleView.groupBy.mock.calls[0][0]
    expect(query.take).toBe(5)
    expect(query.where.viewedAt.lt).toEqual(new Date('2026-11-20T00:00:00Z'))
    expect(prismaMock.subscriber.count.mock.calls[0][0].where.status).toBe('ACTIVE')
  })
  it('withholds misleading prelaunch growth figures',async()=>{
    const review=await getWeeklyGrowthReview(new Date('2026-10-27T13:00:00Z'))
    expect(review.historicalWarning).not.toBeNull()
    expect(review.changes.articleViews).toBeNull()
    expect(review.changes.sitePageViews).toBeNull()
  })
  it('handles an absent previous baseline honestly',()=>{
    expect(growthDelta(50,0,true)).toBeNull()
    expect(growthDelta(50,25,false)).toBeNull()
  })
})
