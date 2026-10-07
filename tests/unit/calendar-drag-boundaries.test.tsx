// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CalendarView } from '@/components/editorial/CalendarView'
import { buildMonthGrid } from '@/lib/editorialCalendar'
import { apiRequest } from '@/lib/apiClient'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(async () => ({})), asApiError: (reason: Error) => reason }))
vi.mock('@/components/editorial/PortalAnimated', () => ({ PortalPage: ({ children }: { children: ReactNode }) => <div>{children}</div>, PortalSection: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function fixture() {
  render(<CalendarView month="2027-01" weeks={buildMonthGrid('2027-01')} itemsByDay={{ '2027-01-15': [{ id: 'owned-scheduled', title: 'Controlled scheduled item', status: 'SCHEDULED', authorName: 'Controlled writer', categoryName: null, timeLabel: '12:30', dateKey: '2027-01-15', updatedAt: '2027-01-01T00:00:00.000Z' }] }} unscheduled={[]} unscheduledTotal={0} todayKey="2027-01-01" fetchError={false} />)
  const source = screen.getByRole('link', { name: /Controlled scheduled item/ })
  const target = screen.getByRole('button', { name: /Saturday, 16 January 2027/ })
  const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
  const event = (type: string) => {
    const e = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'dataTransfer', { value: transfer })
    return e
  }
  return { source, target, event }
}

it('accepts dragover arriving before React commits the drag-start visual state', async () => {
  const { source, target, event } = fixture()
  const over = event('dragover')
  await act(async () => { source.dispatchEvent(event('dragstart')); target.dispatchEvent(over) })
  expect(over.defaultPrevented, 'Native drop requires dragover to be accepted immediately').toBe(true)
})

it('a fast drop retains the scheduled item identity before the visual render commits', async () => {
  const { source, target, event } = fixture()
  await act(async () => { source.dispatchEvent(event('dragstart')); target.dispatchEvent(event('drop')) })
  expect(apiRequest).toHaveBeenCalledOnce()
  expect(apiRequest).toHaveBeenCalledWith('/api/editorial/calendar', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ articleId: 'owned-scheduled', date: '2027-01-16', expectedUpdatedAt: '2027-01-01T00:00:00.000Z' }) }))
})
