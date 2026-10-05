'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  if (dismissed) return null

  const dismiss = async () => {
    if (pending) return
    setPending(true); setError('')
    try {
      await apiRequest(GAMIFICATION_API_ROUTES.achievementsMarkSeen, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [achievementId] }),
      })
      setDismissed(true)
    } catch (cause) { setError(asApiError(cause).message) }
    finally { setPending(false) }
  }

  return (
    <div
      role="status"
      className="mb-6 flex items-center justify-between gap-3 border-l-4 border-gold bg-cream px-5 py-3 text-navy"
    >
      <p className="text-sm font-medium" style={{ fontFamily: 'var(--font-serif)' }}>
        Your first article has been published.
      </p>
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      <button
        type="button"
        onClick={() => void dismiss()}
        disabled={pending}
        aria-label="Dismiss"
        className="flex h-11 w-11 shrink-0 items-center justify-center text-navy/60 hover:text-navy"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
