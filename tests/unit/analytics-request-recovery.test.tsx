// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AnalyticsDashboard } from '@/app/editorial/(portal)/analytics/AnalyticsDashboard'
vi.mock('@/app/editorial/(portal)/analytics/OverviewTab', () => ({ OverviewTab: ({ data }: { data: unknown }) => <p>{JSON.stringify(data)}</p> }))
vi.mock('@/app/editorial/(portal)/analytics/ContentTab', () => ({ ContentTab: () => null }))
vi.mock('@/app/editorial/(portal)/analytics/AudienceTab', () => ({ AudienceTab: () => null }))
vi.mock('@/app/editorial/(portal)/analytics/EngagementTab', () => ({ EngagementTab: () => null }))
vi.mock('@/app/editorial/(portal)/analytics/LeaderboardTab', () => ({ LeaderboardTab: () => null }))
vi.mock('@/app/editorial/(portal)/analytics/DistributionTab', () => ({ DistributionTab: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const response = (marker: string, status = 200) => ({ ok: status === 200, status, json: async () => ({ marker }) })
it('requests the initial selection once', async () => {
 const fetcher = vi.fn().mockResolvedValue(response('initial'))
 vi.stubGlobal('fetch', fetcher)
 render(<AnalyticsDashboard userRole="ADMIN" />)
 await screen.findByText('{"marker":"initial"}')
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it('a delayed old period cannot replace the selected period', async () => {
 let resolve!: (value: ReturnType<typeof response>) => void
 const old = new Promise<ReturnType<typeof response>>(yes => { resolve = yes })
 vi.stubGlobal('fetch', vi.fn().mockImplementation(url => String(url).includes('period=30d') ? old : Promise.resolve(response('current'))))
 render(<AnalyticsDashboard userRole="ADMIN" />)
 fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
 fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
 await screen.findByText('{"marker":"current"}')
 await act(async () => { resolve(response('obsolete')); await old })
 expect(screen.queryByText('{"marker":"current"}')).not.toBeNull()
 expect(screen.queryByText('{"marker":"obsolete"}')).toBeNull()
})
it('a failed selection shows an error and deliberate retry recovers its data', async () => {
 const fetcher = vi.fn().mockResolvedValue(response('failed', 503))
 vi.stubGlobal('fetch', fetcher)
 render(<AnalyticsDashboard userRole="GROWTH" />)
 await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
 expect(screen.getByRole('alert').textContent).toContain('503')
 fetcher.mockResolvedValue(response('recovered'))
 fireEvent.click(screen.getByRole('button', { name: 'Retry analytics' }))
 await screen.findByText('{"marker":"recovered"}')
 expect(screen.queryByRole('alert')).toBeNull()
})
