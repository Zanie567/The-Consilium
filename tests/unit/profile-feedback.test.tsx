// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UserProfileEditor } from '@/components/editorial/UserProfileEditor'
import { apiRequest } from '@/lib/apiClient'

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: Error) => reason }))
vi.mock('@/components/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.mocked(apiRequest).mockReset() })

it('an earlier success timer cannot erase a later password validation error', async () => {
  vi.useFakeTimers()
  vi.mocked(apiRequest).mockResolvedValue({ isActive: false })
  render(<UserProfileEditor categories={[]} user={{ id: 'account', name: 'Controlled Account', email: 'account@consilium.test', role: 'WRITER', isActive: true, slug: null, bio: null, image: null, createdAt: '2026-10-04T12:00:00Z', lastLoginAt: null, adminNotes: null, categoryAssignments: [], articles: [] }} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deactivate Account' })) })
  expect(screen.getByRole('status').textContent).toContain('Saved.')
  act(() => vi.advanceTimersByTime(2900))
  fireEvent.click(screen.getByRole('button', { name: 'Set Password Directly' }))
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
  expect(screen.getByRole('alert').textContent).toContain('Password must be at least 8 characters.')
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.getByRole('alert').textContent).toContain('Password must be at least 8 characters.')
  expect(apiRequest).toHaveBeenCalledTimes(1)
})
