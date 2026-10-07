'use client'

import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  /** `danger` styles the confirm button red (taking something down). */
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A modal yes/no for actions that change what the public sees. Focus starts on Cancel so a
 * stray Enter or a double-click cannot confirm; Escape cancels; the confirm button is disabled
 * while the action is running so a repeated click cannot send it twice.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, tone = 'default', busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-elevated)] p-6 shadow-xl">
        <h2 id="confirm-title" className="mb-2 text-lg font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{title}</h2>
        <p id="confirm-message" className="mb-6 text-sm text-[var(--fg-muted)]">{message}</p>
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:border-gold hover:text-gold disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-60 ${tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-navy text-gold hover:bg-navy-dark'}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
