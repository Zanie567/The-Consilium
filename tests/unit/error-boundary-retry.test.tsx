// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ErrorPage from '@/app/error'
import GlobalErrorPage from '@/app/global-error'

afterEach(cleanup)

// Next 16.3 renamed the boundary's `unstable_retry` prop to `retry` and stopped passing the old name,
// so a stale prop name leaves "Try again" calling undefined. Pin both sides of the contract.
it('the installed Next passes `retry` to error boundaries', () => {
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('next/dist/client/components/error-boundary.js'), 'utf8')
  expect(source).toMatch(/\bretry: this\.retry\b/)
  expect(source).not.toContain('unstable_retry')
})

it.each([
  ['page boundary', ErrorPage],
  ['global boundary', GlobalErrorPage],
])('the %s "Try again" button calls retry', (_name, Boundary) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const retry = vi.fn()
  render(<Boundary error={Object.assign(new Error('synthetic'), { digest: 'd1' })} retry={retry} />)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).toHaveBeenCalledTimes(1)
})
