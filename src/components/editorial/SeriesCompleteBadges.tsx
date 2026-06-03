'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { GAMIFICATION_API_ROUTES } from '@/lib/constants'

type SeriesAchievement = { id: string; title: string | null }

/**
 * Small dismissible badges for unseen series-completion achievements, shown below
 * the first-publish banner on the writer dashboard. Dismissing marks every shown
 * achievement seen (one mark-seen call carrying all ids) so the badges do not
 * reappear. The dashboard renders this only with unseen achievements.
 */
export function SeriesCompleteBadges({ items }: { items: SeriesAchievement[] }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || items.length === 0) return null

  const dismiss = () => {
    setDismissed(true)
    fetch(GAMIFICATION_API_ROUTES.achievementsMarkSeen, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: items.map((item) => item.id) }),
    }).catch(() => {})
  }

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <span
          key={item.id}
          className="inline-flex items-center border border-gold px-2.5 py-1 text-xs font-semibold text-gold"
        >
          Series complete{item.title ? `: ${item.title}` : ''}
        </span>
      ))}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss series achievements"
        className="flex h-11 items-center justify-center px-2 text-[var(--fg-faint)] hover:text-[var(--fg)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
