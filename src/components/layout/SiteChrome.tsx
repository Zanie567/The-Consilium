'use client'

import { usePathname } from 'next/navigation'

/**
 * Renders public site chrome only outside the staff portals.
 *
 * The Navbar and SignupPrompt already gate themselves this way, but the
 * Footer and ScrollIndicator never did, so both rendered inside the editorial
 * portal: the marketing footer added ~690px of dead height below every
 * dashboard page (pushing the sidebar out of view), and the ScrollIndicator
 * draws a document-level scrollbar for a document the portal no longer
 * scrolls — the portal is a bounded shell that scrolls its own content region.
 *
 * Children are passed through rather than imported here so the Footer stays a
 * server component on public pages.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname.startsWith('/editorial') || pathname.startsWith('/admin')) return null
  return <>{children}</>
}
