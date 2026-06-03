'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { GAMIFICATION_API_ROUTES } from '@/lib/constants'

/**
 * One-time dismissible banner shown on the writer dashboard the first time one of
 * the writer's articles reaches PUBLISHED. The dashboard renders this only when
 * the server has already confirmed an unseen first_publish achievement, so the
 * component owns just its dismissed state. Dismissing marks the achievement seen
 * so it does not reappear on the next load.
 */
export function FirstPublishBanner({ achievementId }: { achievementId: string }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const dismiss = () => {
    // Hide optimistically. A failed mark-seen only means the banner reappears on
    // the next load, which is acceptable, so this is fire-and-forget.
    setDismissed(true)
    fetch(GAMIFICATION_API_ROUTES.achievementsMarkSeen, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [achievementId] }),
    }).catch(() => {})
  }

  return (
    <div
      role="status"
      className="mb-6 flex items-center justify-between gap-3 border-l-4 border-gold bg-cream px-5 py-3 text-navy"
    >
      <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-serif)' }}>
        Your first article has been published.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-11 w-11 shrink-0 items-center justify-center text-navy/60 hover:text-navy"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
