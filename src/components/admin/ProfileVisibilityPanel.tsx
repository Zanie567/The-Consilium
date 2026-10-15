'use client'

import { useState } from 'react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { publicSectionLabel } from '@/lib/teamHierarchy'
import {
  BLOCKER_TEXT,
  NOTE_TEXT,
  STATUS_LABEL,
  publicationSummary,
  type PublicationAssessment,
  type PublicationStatus,
} from '@/lib/teamVisibility'

const buttonClass =
  'inline-flex min-h-[40px] items-center justify-center px-4 text-xs font-bold uppercase tracking-widest disabled:opacity-60'

const STATUS_TONE: Record<PublicationStatus, string> = {
  published: 'border-emerald-600/40 text-emerald-600',
  hidden: 'border-[var(--border-strong)] text-[var(--fg)]',
  incomplete: 'border-amber-500/50 text-amber-600',
  ineligible: 'border-red-500/40 text-red-500',
}

interface Props {
  card: { id: string; name: string; position: string; publicTier: string | null; updatedAt: string; publication: PublicationAssessment }
  /** The form below has unsaved edits: publish what is saved only after they are saved or discarded. */
  dirty: boolean
  /** Reloads the directory after a change and announces the message in the page's status line. */
  onChanged: (message: string) => Promise<void> | void
}

/**
 * The publication control for one Meet the Team card, at the top of its editor: where the card stands
 * (Published, Hidden, Incomplete or Not eligible), exactly why it is not on the public page, and one
 * deliberate action to publish or hide it. The action changes only the visibility switch.
 */
export function ProfileVisibilityPanel({ card, dirty, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const p = card.publication
  const headingId = `visibility-${card.id}`

  async function setVisible(visible: boolean) {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      await apiRequest(`/api/admin/team-cards/${card.id}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible, expectedUpdatedAt: card.updatedAt }),
      })
      const text = visible
        ? `Published. "${card.name}" now appears on the Our Team page under ${publicSectionLabel({ publicTier: card.publicTier, role: card.position })}.`
        : `Hidden. "${card.name}" is no longer on the Our Team page. Nothing else on the profile was changed.`
      setResult({ ok: true, text })
      await onChanged(text)
    } catch (reason) {
      setResult({ ok: false, text: `Not changed. ${asApiError(reason).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} data-testid="profile-visibility" className="border border-[var(--border-strong)] bg-[var(--bg)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={headingId} className="flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--fg)]">
            Our Team page
            <span data-testid="publication-status" className={`inline-block border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${STATUS_TONE[p.status]}`}>
              {STATUS_LABEL[p.status]}
            </span>
          </h3>
          <p className="text-sm text-[var(--fg-muted)]">{publicationSummary(p)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.status === 'published' && (
            <a href="/team" target="_blank" rel="noreferrer" className={`${buttonClass} text-[var(--fg-muted)] underline`}>View page</a>
          )}
          {p.visible ? (
            <button type="button" disabled={busy} onClick={() => void setVisible(false)} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
              {busy ? 'Hiding…' : 'Hide from public page'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || dirty || !p.canPublish}
              onClick={() => void setVisible(true)}
              className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}
            >
              {busy ? 'Publishing…' : 'Publish profile'}
            </button>
          )}
        </div>
      </div>

      {p.blockers.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)]">Why it is not on the page</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--fg)]">
            {p.blockers.map((b) => <li key={b}>{BLOCKER_TEXT[b]}</li>)}
          </ul>
        </div>
      )}
      {p.notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-[var(--fg-muted)]" aria-label="Notes">
          {p.notes.map((n) => <li key={n} data-testid={`publication-note-${n}`}>{NOTE_TEXT[n]}</li>)}
        </ul>
      )}
      {!p.visible && p.canPublish && dirty && (
        <p className="mt-3 text-xs text-amber-600">Save or discard your changes below first, so what you publish is what you see.</p>
      )}
      {/* Success is also announced by the page's status line (onChanged); only a failure is an alert here. */}
      {result && (
        <p role={result.ok ? undefined : 'alert'} data-testid="visibility-result" className={`mt-3 text-sm ${result.ok ? 'text-emerald-600' : 'text-red-500'}`}>{result.text}</p>
      )}
    </section>
  )
}
