// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CoverImage } from '@/components/ui/CoverImage'

// next/image is reduced to the <img> it renders, keeping the props this component decides.
vi.mock('next/image', () => ({
  default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function MockImage({ fill: _fill, unoptimized, fetchPriority, ...props }, ref) {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img ref={ref} data-unoptimized={String(Boolean(unoptimized))} data-priority={String(fetchPriority ?? '')} {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
  }),
}))
afterEach(cleanup)

const fallbacks = { fallback: <span>no cover</span>, brokenFallback: <span>broken cover</span> }
const img = () => document.querySelector('img')

it('shows the article’s own cover through the optimiser, lazily, at the size asked for', () => {
  render(<CoverImage src="https://images.unsplash.com/photo-1?w=1200" alt="" sizes="96px" {...fallbacks} />)
  expect(img()?.getAttribute('src')).toBe('https://images.unsplash.com/photo-1?w=1200')
  expect(img()?.getAttribute('sizes')).toBe('96px')
  expect(img()?.getAttribute('loading')).toBe('lazy')
  expect(img()?.dataset.unoptimized).toBe('false')
  expect(screen.queryByText('no cover')).toBeNull()
})

it('loads a host the optimiser may not fetch directly instead of letting it fail', () => {
  render(<CoverImage src="https://example.org/cover.jpg" alt="" sizes="96px" {...fallbacks} />)
  expect(img()?.dataset.unoptimized).toBe('true')
})

it('loads the first picture in view eagerly and at high priority', () => {
  render(<CoverImage src="/team/a.png" alt="" sizes="100vw" eager {...fallbacks} />)
  expect(img()?.getAttribute('loading')).toBe('eager')
  expect(img()?.dataset.priority).toBe('high')
})

it('shows the "no cover" fallback, and requests nothing, when there is no cover', () => {
  render(<CoverImage src={null} alt="" sizes="96px" {...fallbacks} />)
  expect(img()).toBeNull()
  expect(screen.getByText('no cover')).toBeTruthy()
})

it('shows the "broken" fallback, and requests nothing, for a value that cannot be an image address', () => {
  render(<CoverImage src="javascript:alert(1)" alt="" sizes="96px" {...fallbacks} />)
  expect(img()).toBeNull()
  expect(screen.getByText('broken cover')).toBeTruthy()
})

it('replaces a picture that fails to load with the "broken" fallback', () => {
  render(<CoverImage src="https://images.unsplash.com/gone" alt="" sizes="96px" {...fallbacks} />)
  fireEvent.error(img()!)
  expect(img()).toBeNull()
  expect(screen.getByText('broken cover')).toBeTruthy()
})

it('uses the plain fallback for a broken picture when no separate one is given', () => {
  render(<CoverImage src="https://images.unsplash.com/gone" alt="" sizes="96px" fallback={<span>no cover</span>} />)
  fireEvent.error(img()!)
  expect(screen.getByText('no cover')).toBeTruthy()
})

it('tries again when the article is given a different cover after a failure', () => {
  const { rerender } = render(<CoverImage src="https://images.unsplash.com/gone" alt="" sizes="96px" {...fallbacks} />)
  fireEvent.error(img()!)
  expect(img()).toBeNull()
  rerender(<CoverImage src="https://images.unsplash.com/new" alt="" sizes="96px" {...fallbacks} />)
  expect(img()?.getAttribute('src')).toBe('https://images.unsplash.com/new')
})

it('catches a picture that had already failed before the page became interactive', () => {
  // The browser reports a failed image as complete with no pixels; onError fired before hydration.
  const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
  try {
    render(<CoverImage src="https://images.unsplash.com/gone" alt="" sizes="96px" {...fallbacks} />)
    expect(screen.getByText('broken cover')).toBeTruthy()
  } finally {
    complete.mockRestore()
    width.mockRestore()
  }
})
