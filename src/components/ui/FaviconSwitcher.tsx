'use client'

/**
 * FaviconSwitcher
 *
 * Chrome and some other browsers don't reliably honour `media` attributes
 * on <link rel="icon"> tags for `prefers-color-scheme`. This component runs
 * once on the client, reads the live media query, sets the correct 32px
 * favicon immediately, and then listens for OS theme changes.
 *
 * The declarative <link media="..."> tags in layout.tsx remain as a
 * progressive enhancement for browsers that do support them.
 */

import { useEffect } from 'react'

const FAVICONS = {
  dark: '/favicon-cream-32.png',   // cream emblem — visible on dark tab bars
  light: '/favicon-navy-32.png',   // navy emblem  — visible on light tab bars
} as const

function applyFavicon(prefersDark: boolean) {
  // Target only the 32px icon link to avoid fighting with the ICO fallback
  const existing = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/png"][sizes="32x32"]'
  )
  const href = prefersDark ? FAVICONS.dark : FAVICONS.light

  if (existing) {
    if (existing.href !== href) existing.href = href
  } else {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/png'
    link.sizes = '32x32'
    link.href = href
    // Append — browser prefers later entries when sizes match
    document.head.appendChild(link)
  }
}

export function FaviconSwitcher() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    // Apply immediately on mount
    applyFavicon(mq.matches)

    // Keep in sync if the user changes their OS theme mid-session
    const handler = (e: MediaQueryListEvent) => applyFavicon(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Renders nothing — side-effect only
  return null
}
