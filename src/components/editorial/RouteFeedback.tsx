'use client'

/**
 * Shows a message queued with `queueRouteFeedback` on the route the person lands on,
 * once. It lives in the portal layout, which stays mounted across navigations, so it
 * reads the queue whenever the pathname changes (and on first load). The message is
 * tied to the route it was shown on and disappears when they navigate again.
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { takeRouteFeedback } from '@/lib/routeFeedback'

export function RouteFeedback() {
  const pathname = usePathname()
  const [shown, setShown] = useState<{ message: string; path: string } | null>(null)

  useEffect(() => {
    const message = takeRouteFeedback()
    // Only replace on a real message: a second pass over the same route (React strict
    // mode, a re-render) finds the queue already empty and must not clear what was shown.
    if (message) setShown({ message, path: pathname })
  }, [pathname])

  if (!shown || shown.path !== pathname) return null

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm flex items-start gap-3 border border-red-500/30 bg-[var(--bg-elevated)] px-4 py-3 text-sm text-red-500 shadow-lg"
    >
      <p className="flex-1">{shown.message}</p>
      <button
        type="button"
        onClick={() => setShown(null)}
        aria-label="Dismiss message"
        className="shrink-0 text-[var(--fg-faint)] hover:text-[var(--fg)]"
      >
        <X size={14} />
      </button>
    </div>
  )
}
