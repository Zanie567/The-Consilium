'use client'

import { useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { primaryButton } from './NewsletterShell'

/** Unsubscribe links from before the preference centre: a deliberate press, never on page load. */
export function LegacyUnsubscribe({ email, legacyToken }: { email: string; legacyToken: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  async function submit() {
    setState('loading')
    try {
      await apiRequest('/api/newsletter/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, legacyToken }) })
      setState('done')
    } catch {
      setState('error')
    }
  }
  if (state === 'done') {
    return (
      <p role="status" className="text-sm text-[var(--fg)] leading-relaxed">
        You are unsubscribed. You will not receive any more newsletters from us, and this address will not be added again unless you subscribe and confirm.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">Press the button to stop all newsletters from The Consilium.</p>
      <button type="button" onClick={submit} className={primaryButton} disabled={state === 'loading'}>
        {state === 'loading' ? 'Unsubscribing…' : 'Unsubscribe'}
      </button>
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          This link is not valid any more. Request a preferences link below instead.
        </p>
      )}
    </div>
  )
}
