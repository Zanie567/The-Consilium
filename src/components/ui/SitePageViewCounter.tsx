'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { analyticsIdentity } from '@/lib/analyticsIdentity'

// The article page already has ViewCounter and must not also create a SiteView.
// Private/editorial/account routes are not readership traffic. Keep the
// collector's existing session/consent behavior and never include query strings.
const EXCLUDED_PREFIXES = [
  '/editorial', '/admin', '/api', '/auth',
  '/login', '/signup', '/sign-in', '/sign-up',
  '/forgot-password', '/reset-password', '/verify-email',
  '/account', '/profile', '/settings', '/banned',
  '/testing', '/preview',
]

export function shouldTrackPublicPage(pathname: string | null): boolean {
  if (!pathname || !pathname.startsWith('/')) return false
  const path = pathname.toLowerCase()
  if (path.startsWith('/articles/')) return false
  return !EXCLUDED_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'))
}

export function SitePageViewCounter() {
  const pathname = usePathname()

  useEffect(() => {
    if (!shouldTrackPublicPage(pathname)) return
    // Navigation in the App Router does not reload the root layout, so we
    // track route changes here. The collector deduplicates same-page events.
    const body = JSON.stringify({
      pagePath: pathname,
      ...analyticsIdentity(),
      referrer: document.referrer,
    })
    void fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Analytics must never interfere with site navigation.
    })
  }, [pathname])

  return null
}
