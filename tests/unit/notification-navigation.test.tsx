// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationBell } from '@/components/editorial/NotificationBell'
import { apiRequest } from '@/lib/apiClient'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ onNavigate, children, ...props }: { onNavigate?: (event: { preventDefault: () => void }) => void; children: React.ReactNode; href: string }) => <a {...props} onClick={event => { event.preventDefault(); onNavigate?.({ preventDefault: () => event.preventDefault() }) }}>{children}</a> }))
vi.mock('@/components/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: Error) => reason }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(apiRequest).mockReset(); push.mockReset() })

it('failed individual acknowledgement stays visible and unread until a deliberate successful retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => [{ id: 'notification', type: 'comment', title: 'Draft feedback', message: 'Review this feedback', read: false, createdAt: '2026-10-04T12:00:00Z', articleId: 'article', article: null }] }))
  vi.mocked(apiRequest).mockRejectedValue(new Error('Read unavailable'))
  render(<NotificationBell />)
  fireEvent.click(await screen.findByRole('button', { name: '1 unread notifications' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('link', { name: /Draft feedback/ }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/editorial/notifications/notification', { method: 'PATCH' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Read unavailable')
  expect(screen.queryByRole('button', { name: '1 unread notifications' })).not.toBeNull()
  expect(push).not.toHaveBeenCalled()
  vi.mocked(apiRequest).mockResolvedValue({})
  fireEvent.click(screen.getByRole('link', { name: /Draft feedback/ }))
  await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith('/editorial/articles/article/edit'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeNull()
})
