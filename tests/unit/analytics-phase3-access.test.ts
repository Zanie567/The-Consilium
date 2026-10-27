import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(()=>({
  session:vi.fn(),search:vi.fn(),weekly:vi.fn(),
}))
vi.mock('@/lib/auth',()=>({getVerifiedSessionUser:mocks.session}))
vi.mock('@/lib/searchConsoleAnalytics',()=>({getSearchConsoleReport:mocks.search}))
vi.mock('@/lib/weeklyGrowthReview',()=>({getWeeklyGrowthReview:mocks.weekly}))
import { GET as searchGET } from '@/app/api/editorial/analytics/search-console/route'
import { GET as weeklyGET } from '@/app/api/editorial/analytics/weekly-review/route'

afterEach(()=>vi.clearAllMocks())
it('does not fetch Google or weekly analytics without editorial access',async()=>{
  mocks.session.mockResolvedValue(null)
  expect((await searchGET(new NextRequest('http://localhost/api/editorial/analytics/search-console?period=30d'))).status).toBe(401)
  expect((await weeklyGET()).status).toBe(401)
  expect(mocks.search).not.toHaveBeenCalled()
  expect(mocks.weekly).not.toHaveBeenCalled()
})
it('returns explicit not-connected state only to authorised editors',async()=>{
  mocks.session.mockResolvedValue({id:'admin',role:'ADMIN'})
  mocks.search.mockResolvedValue({status:'not_connected',message:'Configure GSC'})
  const res=await searchGET(new NextRequest('http://localhost/api/editorial/analytics/search-console?period=30d'))
  expect(res.status).toBe(200)
  expect((await res.json()).status).toBe('not_connected')
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  expect(mocks.search).toHaveBeenCalledWith('30d')
})
it('rejects an unexpected date-range value before accessing Google',async()=>{
  mocks.session.mockResolvedValue({id:'admin',role:'ADMIN'})
  const res=await searchGET(new NextRequest('http://localhost/api/editorial/analytics/search-console?period=5y'))
  expect(res.status).toBe(400)
  expect(mocks.search).not.toHaveBeenCalled()
})
it('keeps the weekly review private and reports failures without leaking details',async()=>{
  mocks.session.mockResolvedValue({id:'admin',role:'ADMIN'})
  mocks.weekly.mockRejectedValue(new Error('do not show database details'))
  const res=await weeklyGET()
  expect(res.status).toBe(503)
  expect(JSON.stringify(await res.json())).not.toContain('database details')
})
