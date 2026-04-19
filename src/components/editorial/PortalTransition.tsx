'use client'

/**
 * Wraps editorial portal page content with a subtle enter animation.
 * Because React uses the `key` prop to unmount/remount the div on every
 * pathname change, the CSS animation re-fires on each navigation —
 * giving a lightweight fade + slide-up transition without any animation library.
 */

import { usePathname } from 'next/navigation'

export function PortalTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div key={pathname} className="portal-page-enter h-full">
      {children}
    </div>
  )
}
