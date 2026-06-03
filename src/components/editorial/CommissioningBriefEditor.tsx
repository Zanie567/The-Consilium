'use client'

import { useState } from 'react'
import { COMMISSIONING_BRIEF_MAX_LENGTH, EDITORIAL_API_ROUTES } from '@/lib/constants'

/**
 * Admin/Growth control for the commissioning brief shown to writers on their
 * dashboard. Renders nothing for any other role. Mirrors the CommendationEditor
 * save pattern: optimistic-free, with an inline confirmation after a successful
 * PATCH.
 */
export function CommissioningBriefEditor({
  initialBrief,
  userRole,
}: {
  initialBrief: string | null
  userRole: string
}) {
  const [value, setValue] = useState(initialBrief ?? '')
  const [savedValue, setSavedValue] = useState(initialBrief ?? '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Only ADMIN and GROWTH may edit the brief; everyone else sees nothing here.
  if (userRole !== 'ADMIN' && userRole !== 'GROWTH') return null

  const dirty = value.trim() !== savedValue.trim()

  const save = async () => {
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch(EDITORIAL_API_ROUTES.commissioningBrief, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: value.trim() === '' ? null : value.trim() }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const data = (await res.json()) as { brief: string | null }
      const next = data.brief ?? ''
      setValue(next)
      setSavedValue(next)
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
      <label
        htmlFor="commissioning-brief"
        className="mb-1 block text-xs font-bold uppercase tracking-widest text-[var(--fg)]"
      >
        Commissioning brief
      </label>
      <p className="mb-3 text-xs text-[var(--fg-muted)]">
        Shown to writers on their dashboard to signal what the desk is looking for now.
      </p>
      <textarea
        id="commissioning-brief"
        value={value}
        maxLength={COMMISSIONING_BRIEF_MAX_LENGTH}
        rows={4}
        placeholder="What is the editorial team looking for right now?"
        onChange={(e) => {
          setValue(e.target.value)
          setStatus('idle')
        }}
        className="w-full resize-none border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-gold"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--fg-faint)]">
        <span aria-live="polite">
          {status === 'saved'
            ? 'Brief saved.'
            : status === 'error'
              ? 'Could not save. Try again.'
              : ''}
        </span>
        <span>
          {value.length}/{COMMISSIONING_BRIEF_MAX_LENGTH}
        </span>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="mt-2 min-h-[44px] bg-navy px-5 py-2 text-xs font-bold uppercase tracking-widest text-gold disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save brief'}
      </button>
    </section>
  )
}
