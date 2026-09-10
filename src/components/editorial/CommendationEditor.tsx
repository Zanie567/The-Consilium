'use client'

import { useState } from 'react'
import { Award } from 'lucide-react'
import { apiRequest, asApiError } from '@/lib/apiClient'

const MAX_LENGTH = 200

/**
 * Editor-only control for setting or clearing an article's editorial
 * commendation. Renders inside the review studio actions column.
 */
export function CommendationEditor({
  articleId,
  initialValue,
}: {
  articleId: string
  initialValue: string | null
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const [savedValue, setSavedValue] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const dirty = value.trim() !== savedValue.trim()

  const save = async () => {
    setSaving(true)
    setStatus('idle')
    setErrorMessage('')
    try {
      const data = await apiRequest<{ editorialCommendation: string | null }>(
        `/api/editorial/articles/${articleId}/commendation`,
        {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commendation: value.trim() === '' ? null : value.trim() }),
        }
      )
      const next = data.editorialCommendation ?? ''
      setValue(next)
      setSavedValue(next)
      setStatus('saved')
    } catch (reason) {
      setStatus('error')
      setErrorMessage(asApiError(reason).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <label
        htmlFor="editorial-commendation"
        className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--fg)]"
      >
        <Award size={14} className="text-gold" />
        Editorial commendation (optional)
      </label>
      <textarea
        id="editorial-commendation"
        value={value}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder="One sentence recognising the writer's work."
        onChange={(e) => {
          setValue(e.target.value)
          setStatus('idle')
        }}
        className="w-full resize-none border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-gold"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--fg-faint)]">
        <span aria-live="polite">
          {status === 'saved' ? 'Saved.' : status === 'error' ? errorMessage : ''}
        </span>
        <span>
          {value.length}/{MAX_LENGTH}
        </span>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="mt-2 min-h-[44px] w-full bg-navy px-4 py-2 text-xs font-bold uppercase tracking-widest text-gold disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save commendation'}
      </button>
    </section>
  )
}
