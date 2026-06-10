'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  eventId: string
  unitLabel: string
  minValue: number
  maxValue: number
  currentValue: number | null
}

/**
 * Single numeric input for submitting or revising a prediction. The server
 * re-validates everything; this form only provides friendly hints.
 */
export function PredictionForm({ eventId, unitLabel, minValue, maxValue, currentValue }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(currentValue !== null ? String(currentValue) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/predictions/${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Something went wrong. Please try again.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label
        htmlFor="prediction-value"
        className="block text-xs uppercase tracking-widest text-[var(--fg-muted)]"
      >
        Your prediction
      </label>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[220px]">
          <input
            id="prediction-value"
            type="number"
            step="any"
            inputMode="decimal"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setSaved(false)
            }}
            min={minValue}
            max={maxValue}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 pr-14 text-lg text-[var(--fg)] focus:border-gold focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--fg-faint)]">
            {unitLabel}
          </span>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-gold px-5 py-2.5 text-sm font-semibold text-navy transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {saving ? 'Saving...' : currentValue !== null ? 'Update prediction' : 'Submit prediction'}
        </button>
      </div>
      <p className="text-xs text-[var(--fg-faint)]">
        Allowed range: {minValue} to {maxValue} {unitLabel}. You can revise your answer any time
        before the deadline.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-emerald-600">Saved. Good luck with the release.</p>
      )}
    </form>
  )
}
