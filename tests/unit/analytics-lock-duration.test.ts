import { beforeEach, expect, it, vi } from 'vitest'
const now = new Date('2026-10-18T00:00:00Z')
const mock = vi.hoisted(() => ({trace:[] as string[],tx:{
  $executeRaw:vi.fn(), article:{findFirst:vi.fn()}, articleView:{findFirst:vi.fn(),create:vi.fn()},
  articleEngagementSession:{findUnique:vi.fn(),create:vi.fn(),update:vi.fn()},
}}))
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:(fn:(tx:typeof mock.tx)=>Promise<void>)=>fn(mock.tx)}}))
import {collectAnalytics} from '@/lib/analyticsCollector'
beforeEach(()=>{
  vi.clearAllMocks();mock.trace.length=0
  mock.tx.$executeRaw.mockImplementation((sql:TemplateStringsArray)=>{if(sql.join('').includes('UPDATE articles'))mock.trace.push('counter')})
  mock.tx.article.findFirst.mockResolvedValue({id:'article'})
  mock.tx.articleView.findFirst.mockResolvedValue(null)
  mock.tx.articleView.create.mockImplementation(()=>mock.trace.push('view'))
  mock.tx.articleEngagementSession.findUnique.mockResolvedValue({articleId:'article',activeSeconds:0,startedAt:now,lastSeenAt:now,engagedAt:null})
  mock.tx.articleEngagementSession.update.mockImplementation(()=>mock.trace.push('engagement'))
})
it('takes the shared article counter lock only after engagement work, within the same transaction',async()=>{
  await collectAnalytics({articleId:'article',sessionId:'s',visitId:'11111111-1111-4111-8111-111111111111'},now)
  expect(mock.trace).toEqual(['view','engagement','counter'])
})
it('still counts legacy view-only clients and retries do not increment twice',async()=>{
  await collectAnalytics({articleId:'article',sessionId:'s'},now)
  expect(mock.trace).toEqual(['view','counter'])
  mock.trace.length=0;mock.tx.articleView.findFirst.mockResolvedValue({id:'existing'})
  await collectAnalytics({articleId:'article',sessionId:'s'},now)
  expect(mock.trace).toEqual([])
})
