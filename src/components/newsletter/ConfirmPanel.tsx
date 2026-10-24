'use client'

import Link from 'next/link'
import { useState } from 'react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { primaryButton, secondaryButton } from './NewsletterShell'

type Outcome = 'confirmed' | 'already_confirmed' | 'expired' | 'invalid' | 'suppressed'

/**
 * The confirmation link opens this page; confirming takes a deliberate press (a POST), so automated link
 * scanners in mail systems cannot subscribe anyone.
 */
export function ConfirmPanel({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'loading' | Outcome | 'error'>('idle')
  const [manageUrl, setManageUrl] = useState<string | null>(null)

  async function confirm() {
    setState('loading')
    try {
      const result = await apiRequest<{ status: Outcome; manageUrl?: string }>('/api/newsletter/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setManageUrl(result.manageUrl ?? null)
      setState(result.status)
    } catch (reason) {
      const error = asApiError(reason)
      const body = error.status === 410 ? 'expired' : error.status === 409 ? 'suppressed' : error.status === 400 ? 'invalid' : 'error'
      setState(body)
    }
  }

  if (state === 'confirmed' || state === 'already_confirmed') {
    return (
      <div role="status" className="space-y-4">
        <p className="text-gold-dark dark:text-gold text-xs font-bold uppercase tracking-widest">{state === 'confirmed' ? 'You are subscribed' : 'Already confirmed'}</p>
        <p className="text-sm text-[var(--fg)] leading-relaxed">
          The weekly edition arrives on Fridays. Every email has a link to change topics or unsubscribe in one step.
        </p>
        {manageUrl ? (
          <a href={manageUrl} className={secondaryButton}>
            Choose topics
          </a>
        ) : null}
      </div>
    )
  }
  if (state === 'expired' || state === 'invalid') {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-sm text-[var(--fg)] leading-relaxed">
          {state === 'expired' ? 'This confirmation link has expired.' : 'This confirmation link is not valid (it may already have been replaced by a newer one).'} Subscribe again from the{' '}
          <Link href="/#newsletter-heading" className="text-gold-dark dark:text-gold underline underline-offset-2">
            homepage
          </Link>{' '}
          and use the newest email we send.
        </p>
      </div>
    )
  }
  if (state === 'suppressed') {
    return (
      <p role="alert" className="text-sm text-[var(--fg)] leading-relaxed">
        We cannot send the newsletter to this address because mail to it previously bounced or was reported as unwanted. Please contact the editors if you think this is a mistake.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">Press the button to confirm that you want The Consilium&apos;s weekly edition at this address.</p>
      <button type="button" onClick={confirm} className={primaryButton} disabled={state === 'loading'}>
        {state === 'loading' ? 'Confirming…' : 'Confirm my subscription'}
      </button>
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          Something went wrong. Please try again.
        </p>
      )}
    </div>
  )
}
