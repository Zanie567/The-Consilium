'use client'

import { useId, useState } from 'react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { inputClass, primaryButton } from './NewsletterShell'

/** Ask for a preferences link by email. The answer is the same for every address. */
export function ManageLinkForm({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const id = useId()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState('error')
      setMessage('Enter a valid email address.')
      return
    }
    setState('loading')
    try {
      const result = await apiRequest<{ message: string }>('/api/newsletter/manage-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setState('done')
      setMessage(result.message)
    } catch (reason) {
      setState('error')
      setMessage(asApiError(reason).status === 429 ? 'Too many requests. Please try again later.' : 'Something went wrong. Please try again.')
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="text-sm text-[var(--fg)] leading-relaxed">
        {message} The link expires in 14 days.
      </p>
    )
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {!compact && <p className="text-sm text-[var(--fg-muted)] leading-relaxed">Enter the address you subscribed with and we will email you a personal link to your preferences.</p>}
      <label htmlFor={id} className="block text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)]">
        Email address
      </label>
      <input id={id} name="email" type="email" autoComplete="email" maxLength={254} required className={inputClass} aria-invalid={state === 'error' || undefined} />
      <button type="submit" className={primaryButton} disabled={state === 'loading'}>
        {state === 'loading' ? 'Sending…' : 'Email me a link'}
      </button>
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {message}
        </p>
      )}
    </form>
  )
}
