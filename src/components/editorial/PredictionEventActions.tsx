'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  eventId: string
  status: 'OPEN' | 'CLOSED' | 'RESOLVED' | 'CANCELLED'
  unitLabel: string
}

/**
 * Inline action buttons for one prediction event in the portal list: close,
 * reopen, cancel, manual resolve, and a link to edit. All mutations go through
 * PATCH /api/editorial/predictions/[id].
 */
export function PredictionEventActions({ eventId, status, unitLabel }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [actualValue, setActualValue] = useState('')

  async function send(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/editorial/predictions/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Request failed.')
        return
      }
      setResolving(false)
      router.refresh()
    } catch {
      setError('Request failed.')
    } finally {
      setBusy(false)
    }
  }

  const buttonClass =
    'rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:border-gold/60 hover:text-[var(--fg)] transition-colors disabled:opacity-50'

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {(status === 'OPEN' || status === 'CLOSED') && (
          <a href={`/editorial/predictions/${eventId}/edit`} className={buttonClass}>
            Edit
          </a>
        )}
        {status === 'OPEN' && (
          <button disabled={busy} onClick={() => send({ action: 'close' })} className={buttonClass}>
            Close early
          </button>
        )}
        {status === 'CLOSED' && (
          <button disabled={busy} onClick={() => send({ action: 'reopen' })} className={buttonClass}>
            Reopen
          </button>
        )}
        {(status === 'OPEN' || status === 'CLOSED') && (
          <>
            <button
              disabled={busy}
              onClick={() => setResolving((v) => !v)}
              className={buttonClass}
            >
              Resolve manually
            </button>
            <button
              disabled={busy}
              onClick={() =>
                send(
                  { action: 'cancel' },
                  'Cancel this event? Nobody will be scored and it cannot be undone.'
                )
              }
              className="rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-500 hover:border-red-500/60 transition-colors disabled:opacity-50"
            >
              Cancel event
            </button>
          </>
        )}
      </div>

      {resolving && (
        <form
          className="flex items-center gap-2 mt-2 justify-end"
          onSubmit={(e) => {
            e.preventDefault()
            send(
              { action: 'resolve', actualValue },
              `Resolve with actual value ${actualValue} ${unitLabel}? This scores every prediction and cannot be undone.`
            )
          }}
        >
          <input
            type="number"
            step="any"
            required
            autoFocus
            value={actualValue}
            onChange={(e) => setActualValue(e.target.value)}
            placeholder={`Actual (${unitLabel})`}
            className="w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--fg)] focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy hover:opacity-85 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Scoring...' : 'Resolve'}
          </button>
        </form>
      )}

      {error && <p className="text-xs text-red-500 mt-2 text-right">{error}</p>}
    </div>
  )
}
