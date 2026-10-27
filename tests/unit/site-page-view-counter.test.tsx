// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => router.pathname }))
vi.mock('@/lib/analyticsIdentity', () => ({
  analyticsIdentity: () => ({ sessionId: 'public-page-session', consent: false }),
}))

import { shouldTrackPublicPage, SitePageViewCounter } from '@/components/ui/SitePageViewCounter'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  router.pathname = '/'
})

it('counts public non-article pages, including client-side navigation, exactly once per route change', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetcher)
  const { rerender } = render(<SitePageViewCounter />)

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    pagePath: '/', sessionId: 'public-page-session', consent: false,
  })

  router.pathname = '/editorial/analytics'
  rerender(<SitePageViewCounter />)
  router.pathname = '/articles/a-live-story'
  rerender(<SitePageViewCounter />)
  expect(fetcher).toHaveBeenCalledTimes(1)

  router.pathname = '/about'
  rerender(<SitePageViewCounter />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(JSON.parse(fetcher.mock.calls[1][1].body).pagePath).toBe('/about')
})

it('excludes the existing article tracker, editorial/admin and private account routes', () => {
  expect(shouldTrackPublicPage('/')).toBe(true)
  expect(shouldTrackPublicPage('/authors/sample')).toBe(true)
  expect(shouldTrackPublicPage('/articles')).toBe(true)
  for (const path of [
    '/articles/published-story', '/editorial', '/editorial/analytics',
    '/admin/users', '/api/analytics/track', '/login', '/signup',
    '/reset-password/token', '/settings', '/preview/story',
  ]) {
    expect(shouldTrackPublicPage(path)).toBe(false)
  }
})
