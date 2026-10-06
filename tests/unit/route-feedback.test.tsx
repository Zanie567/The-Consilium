// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RouteFeedback } from '@/components/editorial/RouteFeedback'
import { queueRouteFeedback, takeRouteFeedback } from '@/lib/routeFeedback'

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/editorial' } }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }))

beforeEach(() => { window.sessionStorage.clear(); pathname.current = '/editorial' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shows a queued message once, on the route reached, and never puts it in the URL', () => {
  const { rerender } = render(<RouteFeedback userId="owner" />)
  expect(screen.queryByRole('alert')).toBeNull()

  queueRouteFeedback('Could not mark it read.', 'owner', pathname.current === '/editorial' ? '/editorial/articles/a/edit' : pathname.current)
  pathname.current = '/editorial/articles/a/edit'
  rerender(<RouteFeedback userId="owner" />)
  expect(screen.getByRole('alert').textContent).toContain('Could not mark it read.')
  expect(window.location.search).toBe('')
  expect(takeRouteFeedback('owner', pathname.current)).toBeNull() // consumed: a reload cannot show it again

  pathname.current = '/editorial/review'
  rerender(<RouteFeedback userId="owner" />)
  expect(screen.queryByRole('alert')).toBeNull() // it belonged to the route it was shown on
})

it('can be dismissed', () => {
  pathname.current = '/editorial/articles/a/edit'
  queueRouteFeedback('Could not mark it read.', 'owner', pathname.current === '/editorial' ? '/editorial/articles/a/edit' : pathname.current)
  render(<RouteFeedback userId="owner" />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('ignores empty or malformed storage', () => {
  window.sessionStorage.setItem('consilium:route-feedback', 'not json')
  render(<RouteFeedback userId="owner" />)
  expect(screen.queryByRole('alert')).toBeNull()
  act(() => { window.sessionStorage.setItem('consilium:route-feedback', JSON.stringify({ message: 42 })) })
  expect(takeRouteFeedback('owner', pathname.current)).toBeNull()
})

it('keeps feedback visible when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied') })
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied') })
  pathname.current = '/editorial/articles/a/edit'
  queueRouteFeedback('Read unavailable.', 'owner', pathname.current)
  render(<RouteFeedback userId="owner" />)
  expect(screen.getByRole('alert').textContent).toContain('Read unavailable.')
})
it('refuses another account, another destination and expired feedback', () => {
  queueRouteFeedback('Private draft title.', 'owner', '/editorial/articles/a/edit')
  expect(takeRouteFeedback('different-account', '/editorial/articles/a/edit')).toBeNull()
  queueRouteFeedback('Private draft title.', 'owner', '/editorial/articles/a/edit')
  expect(takeRouteFeedback('owner', '/editorial')).toBeNull()
  queueRouteFeedback('Private draft title.', 'owner', '/editorial/articles/a/edit')
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001)
  expect(takeRouteFeedback('owner', '/editorial/articles/a/edit')).toBeNull()
})
