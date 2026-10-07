'use client'

import { useState } from 'react'
import { apiRequest, asApiError } from '@/lib/apiClient'

/**
 * Shown to an account whose email is not confirmed yet. Confirming is what switches on
 * any team access an administrator has set up for this address, so it is worded
 * generically: it never says whether an invitation exists.
 */
export function VerifyEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null)
  const [sending, setSending] = useState(false)

  const send = async () => {
    setSending(true)
    setState(null)
    try {
      await apiRequest('/api/auth/verify-email/request', { method: 'POST' })
      setState({ ok: true, text: `We sent a confirmation link to ${email}.` })
    } catch (reason) {
      setState({ ok: false, text: asApiError(reason).message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-gold/40 bg-[var(--bg-elevated)] p-4">
        <div>
          <p className="text-sm font-bold text-[var(--fg)]">Confirm your email</p>
          <p className="text-sm text-[var(--fg-muted)]">
            If you have been invited to join The Consilium team, confirming {email} switches your access on.
          </p>
          {state && <p className={`mt-1 text-sm ${state.ok ? 'text-emerald-600' : 'text-red-500'}`}>{state.text}</p>}
        </div>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="min-h-[44px] bg-navy px-5 text-xs font-bold uppercase tracking-widest text-cream disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send confirmation email'}
        </button>
      </div>
    </div>
  )
}
