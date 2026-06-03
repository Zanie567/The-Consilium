'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GAMIFICATION_API_ROUTES, STREAK_INTERVAL_WEEKS } from '@/lib/constants'

const OPTIONS = Array.from(
  { length: STREAK_INTERVAL_WEEKS.MAX - STREAK_INTERVAL_WEEKS.MIN + 1 },
  (_, i) => STREAK_INTERVAL_WEEKS.MIN + i
)

function optionLabel(weeks: number): string {
  return weeks === 1 ? 'Every week' : `Every ${weeks} weeks`
}

/**
 * Lets a writer choose how often they need to publish to keep their streak (the
 * cadence). Saving persists intervalWeeks and recomputes the streak server-side;
 * router.refresh re-renders the server streak card with the new figures.
 */
export function StreakCadenceControl({ initialIntervalWeeks }: { initialIntervalWeeks: number }) {
  const router = useRouter()
  const [intervalWeeks, setIntervalWeeks] = useState(initialIntervalWeeks)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const onChange = async (next: number) => {
    const previous = intervalWeeks
    setIntervalWeeks(next)
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch(GAMIFICATION_API_ROUTES.streak, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalWeeks: next }),
      })
      if (!res.ok) {
        setIntervalWeeks(previous)
        setStatus('error')
        return
      }
      setStatus('saved')
      // Re-render the server component tree so the streak card reflects the recompute.
      router.refresh()
    } catch {
      setIntervalWeeks(previous)
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 sm:p-5 shadow-[var(--shadow-card)] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <label
          htmlFor="streak-cadence"
          className="block text-xs font-bold uppercase tracking-widest text-[var(--fg)]"
        >
          Streak cadence
        </label>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Keep your streak by publishing at least this often.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span aria-live="polite" className="text-[10px] text-[var(--fg-faint)]">
          {status === 'saved' ? 'Saved.' : status === 'error' ? 'Could not save.' : ''}
        </span>
        <select
          id="streak-cadence"
          value={intervalWeeks}
          disabled={saving}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-h-[44px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-gold disabled:opacity-60"
        >
          {OPTIONS.map((weeks) => (
            <option key={weeks} value={weeks}>
              {optionLabel(weeks)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
