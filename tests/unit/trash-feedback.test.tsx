// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TrashList } from '@/components/editorial/TrashList'
import { apiRequest } from '@/lib/apiClient'
import { renderToString } from 'react-dom/server'
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: Error) => reason }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.mocked(apiRequest).mockReset() })
it('an old restore success cannot clear a later restore failure', async () => {
  vi.useFakeTimers()
  vi.mocked(apiRequest).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Restore unavailable'))
  render(<TrashList referenceTime="2026-10-04T12:00:00Z" initialArticles={['first', 'second'].map(id => ({ id, title: id, status: 'DRAFT', deletedAt: '2026-10-04T12:00:00Z', author: { name: 'Controlled Writer' }, category: null }))} />)
  await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]))
  expect(screen.getByText('Article restored successfully.')).not.toBeNull()
  act(() => vi.advanceTimersByTime(2900))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restore' })))
  expect(screen.getByText('Restore unavailable')).not.toBeNull()
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.getByText('Restore unavailable')).not.toBeNull()
  expect(screen.getByText('second')).not.toBeNull()
})

it('server and initial client output agree even when hydration crosses a relative-time boundary', () => {
  vi.useFakeTimers()
  const referenceTime = '2026-10-04T12:00:00Z'
  const props = { referenceTime, initialArticles: [{ id: 'delayed', title: 'delayed', status: 'DRAFT', deletedAt: '2026-10-04T11:59:31Z', author: { name: 'Controlled Writer' }, category: null }] }
  vi.setSystemTime(new Date(referenceTime))
  const server = renderToString(<TrashList {...props} />)
  vi.setSystemTime(new Date('2026-10-04T12:00:02Z'))
  const client = renderToString(<TrashList {...props} />)
  expect(client).toBe(server)
})
