'use client'

import { useState } from 'react'
import { Trash2, Search, AlertTriangle } from 'lucide-react'
// Note: This is a client component. Metadata must be set via the layout or a parent server component.

type Stage = 'idle' | 'searching' | 'found' | 'confirming' | 'deleting' | 'done' | 'error'

export function DataManagement() {
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [message, setMessage] = useState('')

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    if (stage === 'found') {
      setStage('confirming')
      return
    }

    if (stage === 'confirming') {
      setStage('deleting')
      try {
        const res = await fetch('/api/admin/delete-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        })
        const data = await res.json()
        if (res.ok) {
          setStage('done')
          setMessage(`All data for ${data.deletedEmail} has been permanently deleted and a confirmation email has been sent.`)
        } else {
          setStage('error')
          setMessage(data.error ?? 'Deletion failed.')
        }
      } catch {
        setStage('error')
        setMessage('Network error. Please try again.')
      }
      return
    }

    // Initial search
    setStage('searching')
    try {
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), checkOnly: true }),
      })
      const data = await res.json()
      if (res.status === 404) {
        setStage('error')
        setMessage(data.error)
      } else if (res.ok) {
        setStage('found')
        setMessage('')
      } else {
        setStage('error')
        setMessage(data.error ?? 'Something went wrong.')
      }
    } catch {
      setStage('error')
      setMessage('Network error. Please try again.')
    }
  }

  function reset() {
    setEmail('')
    setStage('idle')
    setMessage('')
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
          Data Management
        </h1>
        <p className="text-[var(--fg-muted)] text-sm mt-1">
          Search for a reader by email and permanently delete their account and all associated data
          (GDPR right to erasure).
        </p>
      </div>

      <div className="max-w-xl">
        {stage === 'done' ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 p-6 rounded-sm">
            <p className="text-emerald-700 dark:text-emerald-400 text-sm font-medium mb-4">{message}</p>
            <button
              onClick={reset}
              className="text-xs font-bold uppercase tracking-widest text-[var(--fg)] bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-2 hover:bg-[var(--bg-subtle)] transition-colors"
            >
              Delete Another Account
            </button>
          </div>
        ) : (
          <form onSubmit={handleDelete} className="space-y-4">
            <div>
              <label htmlFor="erasure-email" className="block text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest mb-2">
                Reader Email Address
              </label>
              <div className="flex gap-2">
                <input
                  id="erasure-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (stage !== 'idle') { setStage('idle'); setMessage('') } }}
                  placeholder="reader@example.com"
                  required
                  disabled={stage === 'deleting'}
                  className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-2.5 text-[var(--fg)] text-sm placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-gold transition-colors disabled:opacity-60"
                />
                {stage === 'idle' || stage === 'error' ? (
                  <button
                    type="submit"
                    className="flex items-center gap-2 bg-navy text-gold px-4 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
                  >
                    <Search size={14} />
                    Search
                  </button>
                ) : null}
              </div>
            </div>

            {stage === 'error' && (
              <div className="bg-red-50 border border-red-200 px-4 py-3 text-red-500 text-sm">
                {message}
              </div>
            )}

            {stage === 'found' && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-sm">
                <p className="text-amber-800 text-sm font-medium mb-1">Account found</p>
                <p className="text-amber-700 text-xs mb-3">
                  <strong>{email}</strong>: click below to confirm deletion. This will permanently
                  remove their account, all authored articles (including published articles), reading history, bookmarks, and any newsletter subscription.
                  This action cannot be undone.
                </p>
                <button
                  type="submit"
                  className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-red-700 transition-colors"
                >
                  <AlertTriangle size={13} />
                  Confirm Delete
                </button>
              </div>
            )}

            {stage === 'confirming' && (
              <div className="bg-red-50 border border-red-300 p-4 rounded-sm">
                <p className="text-red-800 text-sm font-bold mb-1">Are you absolutely sure?</p>
                <p className="text-red-500 text-xs mb-3">
                  All personal data and authored articles for <strong>{email}</strong> will be permanently and
                  irreversibly deleted. A confirmation email will be sent to them.
                </p>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex items-center gap-2 bg-red-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-red-800 transition-colors"
                  >
                    <Trash2 size={13} />
                    Yes, delete everything
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {stage === 'deleting' || stage === 'searching' ? (
              <p className="text-[var(--fg-muted)] text-sm">
                {stage === 'searching' ? 'Searching...' : 'Deleting account and all data...'}
              </p>
            ) : null}
          </form>
        )}

        <div className="mt-8 p-4 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-sm">
          <p className="text-[var(--fg-muted)] text-xs leading-relaxed">
            <strong className="text-[var(--fg)]">GDPR right to erasure:</strong> Under UK GDPR, readers
            have the right to request deletion of all personal data held about them. Use this tool
            to fulfil such requests. A confirmation email is automatically sent to the deleted
            address.
          </p>
        </div>
      </div>
    </div>
  )
}
