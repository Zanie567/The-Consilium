'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  if (dismissed || items.length === 0) return null

  const dismiss = async () => {
    if (pending) return
    setPending(true); setError('')
    try {
      await apiRequest(GAMIFICATION_API_ROUTES.achievementsMarkSeen, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: items.map((item) => item.id) }),
      })
      setDismissed(true)
    } catch (cause) { setError(asApiError(cause).message) }
    finally { setPending(false) }
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
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      <button
        type="button"
        onClick={() => void dismiss()}
        disabled={pending}
        aria-label="Dismiss series achievements"
        className="flex h-11 items-center justify-center px-2 text-[var(--fg-faint)] hover:text-[var(--fg)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
