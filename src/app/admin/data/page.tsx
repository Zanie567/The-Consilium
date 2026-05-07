'use client'

import { useState } from 'react'
import { Trash2, Search, AlertTriangle } from 'lucide-react'
// Note: This is a client component — metadata must be set via the layout or a parent server component.

type Stage = 'idle' | 'searching' | 'found' | 'confirming' | 'deleting' | 'done' | 'error'

export default function DataManagementPage() {
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
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy" style={{ fontFamily: 'var(--font-serif)' }}>
          Data Management
        </h1>
        <p className="text-navy/50 text-sm mt-1">
          Search for a reader by email and permanently delete their account and all associated data
          (GDPR right to erasure).
        </p>
      </div>

      <div className="max-w-xl">
        {stage === 'done' ? (
          <div className="bg-green-50 border border-green-200 p-6 rounded-sm">
            <p className="text-green-800 text-sm font-medium mb-4">{message}</p>
            <button
              onClick={reset}
              className="text-xs font-bold uppercase tracking-widest text-navy bg-white border border-navy/20 px-4 py-2 hover:bg-cream transition-colors"
            >
              Delete Another Account
            </button>
          </div>
        ) : (
          <form onSubmit={handleDelete} className="space-y-4">
            <div>
              <label className="block text-navy/60 text-xs font-bold uppercase tracking-widest mb-2">
                Reader Email Address
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (stage !== 'idle') { setStage('idle'); setMessage('') } }}
                  placeholder="reader@example.com"
                  required
                  disabled={stage === 'deleting'}
                  className="flex-1 bg-white border border-gold/20 px-4 py-2.5 text-navy text-sm placeholder:text-navy/30 focus:outline-none focus:border-gold transition-colors disabled:opacity-60"
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
              <div className="bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
                {message}
              </div>
            )}

            {stage === 'found' && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-sm">
                <p className="text-amber-800 text-sm font-medium mb-1">Account found</p>
                <p className="text-amber-700 text-xs mb-3">
                  <strong>{email}</strong>: click below to confirm deletion. This will permanently
                  remove their account, reading history, bookmarks, and any newsletter subscription.
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
                <p className="text-red-700 text-xs mb-3">
                  All personal data for <strong>{email}</strong> will be permanently and
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
                    className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-navy/60 border border-navy/20 hover:border-navy/40 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {stage === 'deleting' || stage === 'searching' ? (
              <p className="text-navy/50 text-sm">
                {stage === 'searching' ? 'Searching...' : 'Deleting account and all data...'}
              </p>
            ) : null}
          </form>
        )}

        <div className="mt-8 p-4 bg-cream/50 border border-gold/10 rounded-sm">
          <p className="text-navy/60 text-xs leading-relaxed">
            <strong className="text-navy/80">GDPR right to erasure:</strong> Under UK GDPR, readers
            have the right to request deletion of all personal data held about them. Use this tool
            to fulfil such requests. A confirmation email is automatically sent to the deleted
            address.
          </p>
        </div>
      </div>
    </div>
  )
}
