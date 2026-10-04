// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RouteFeedback } from '@/components/editorial/RouteFeedback'
import { queueRouteFeedback, takeRouteFeedback } from '@/lib/routeFeedback'

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/editorial' } }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }))

beforeEach(() => { window.sessionStorage.clear(); pathname.current = '/editorial' })
afterEach(cleanup)

it('shows a queued message once, on the route reached, and never puts it in the URL', () => {
  const { rerender } = render(<RouteFeedback />)
  expect(screen.queryByRole('alert')).toBeNull()

  queueRouteFeedback('Could not mark it read.')
  pathname.current = '/editorial/articles/a/edit'
  rerender(<RouteFeedback />)
  expect(screen.getByRole('alert').textContent).toContain('Could not mark it read.')
  expect(window.location.search).toBe('')
  expect(takeRouteFeedback()).toBeNull() // consumed: a reload cannot show it again

  pathname.current = '/editorial/review'
  rerender(<RouteFeedback />)
  expect(screen.queryByRole('alert')).toBeNull() // it belonged to the route it was shown on
})

it('can be dismissed', () => {
  queueRouteFeedback('Could not mark it read.')
  render(<RouteFeedback />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('ignores empty or malformed storage', () => {
  window.sessionStorage.setItem('consilium:route-feedback', 'not json')
  render(<RouteFeedback />)
  expect(screen.queryByRole('alert')).toBeNull()
  act(() => { window.sessionStorage.setItem('consilium:route-feedback', JSON.stringify({ message: 42 })) })
  expect(takeRouteFeedback()).toBeNull()
})
