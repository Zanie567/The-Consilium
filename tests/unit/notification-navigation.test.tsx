// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationBell } from '@/components/editorial/NotificationBell'
import { apiRequest } from '@/lib/apiClient'
import { takeRouteFeedback } from '@/lib/routeFeedback'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ onNavigate, children, ...props }: { onNavigate?: (event: { preventDefault: () => void }) => void; children: React.ReactNode; href: string }) => <a {...props} onClick={event => { event.preventDefault(); onNavigate?.({ preventDefault: () => event.preventDefault() }) }}>{children}</a> }))
vi.mock('@/components/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: Error) => reason }))

const unreadNotification = { id: 'notification', type: 'comment', title: 'Draft feedback', message: 'Review this feedback', read: false, createdAt: '2026-10-04T12:00:00Z', articleId: 'article', article: null }

beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => [unreadNotification] }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(apiRequest).mockReset(); push.mockReset() })

it('opening the list marks nothing read; only the explicit button does', async () => {
  vi.mocked(apiRequest).mockResolvedValue({})
  render(<NotificationBell />)
  fireEvent.click(await screen.findByRole('button', { name: '1 unread notifications' }))
  expect(screen.getByText('Draft feedback')).toBeTruthy()
  expect(apiRequest).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '1 unread notifications' })).not.toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledExactlyOnceWith('/api/editorial/notifications', { method: 'PATCH' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull())
})

it('a failed individual acknowledgement still navigates and leaves one-time feedback for the destination', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('Read unavailable'))
  render(<NotificationBell />)
  fireEvent.click(await screen.findByRole('button', { name: '1 unread notifications' }))
  fireEvent.click(screen.getByRole('link', { name: /Draft feedback/ }))

  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/editorial/notifications/notification', { method: 'PATCH' }))
  await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith('/editorial/articles/article/edit'))
  // Still unread locally (the server was never updated), and the failure is waiting for the new route.
  expect(screen.queryByRole('button', { name: '1 unread notifications' })).not.toBeNull()
  expect(takeRouteFeedback()).toContain('Read unavailable')
  expect(takeRouteFeedback()).toBeNull()
})

it('a successful acknowledgement navigates, marks it read and queues no feedback', async () => {
  vi.mocked(apiRequest).mockResolvedValue({})
  render(<NotificationBell />)
  fireEvent.click(await screen.findByRole('button', { name: '1 unread notifications' }))
  fireEvent.click(screen.getByRole('link', { name: /Draft feedback/ }))

  await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith('/editorial/articles/article/edit'))
  expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeNull()
  expect(takeRouteFeedback()).toBeNull()
})
