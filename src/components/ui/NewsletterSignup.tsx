'use client'

import { useId, useRef, useState } from 'react'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { apiRequest, asApiError } from '@/lib/apiClient'

// Same rule as /api/subscribe, so an address the server would reject is never sent.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function NewsletterSignup() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  // A ref, not `status`: a second submit can arrive before React re-renders the disabled button.
  const inFlight = useRef(false)
  const alertsId = useId()
  const noteId = useId()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    // Read the visible form values, including autofill and input before hydration.
    const form = new FormData(e.currentTarget as HTMLFormElement)
    const email = String(form.get('email') ?? '').trim()
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      setStatus('error')
      setMessage('Enter a valid email address.')
      return
    }
    const website = String(form.get('website') ?? '')
    inFlight.current = true
    setStatus('loading')
    try {
      await apiRequest('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase(), alerts: form.get('alerts') === 'on', ...(website ? { website } : {}) }),
      })
      setStatus('success')
      setMessage('We have sent a confirmation link to that address. Nothing will arrive until you click it.')
    } catch (reason) {
      setStatus('error')
      const error = asApiError(reason)
      setMessage(error.status === 400 ? 'Enter a valid email address.' : error.status === 429 ? error.message : 'Unable to subscribe right now. Please try again.')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <section className="bg-navy py-20 px-4 relative overflow-hidden" aria-labelledby="newsletter-heading">
      {/* Subtle background texture */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #c9a227 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative max-w-2xl mx-auto text-center">
        <AnimateIn variant="fade-up" duration={0.6}>
          <p className="text-gold/80 text-[0.65rem] tracking-[0.35em] uppercase mb-3 font-semibold">
            The Weekly Edition
          </p>
          <h2
            id="newsletter-heading"
            className="text-3xl sm:text-4xl font-bold text-cream mb-4 leading-tight"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Subscribe to The Consilium
          </h2>
          <div className="w-12 h-px bg-gold/40 mx-auto mb-6" />
          <p className="text-cream/70 mb-6 text-sm leading-relaxed max-w-md mx-auto">
            One email every Friday with the week&apos;s published analysis on economics, policy and ideas.
          </p>
        </AnimateIn>

        {status === 'success' ? (
          <div
            key="success"
            role="status"
            className="newsletter-success-in border border-gold/40 bg-gold/10 px-6 sm:px-8 py-6 text-left max-w-md mx-auto"
          >
            <p className="text-gold text-sm font-bold tracking-wide uppercase mb-2">Check your inbox</p>
            <p className="text-cream/85 text-sm leading-relaxed">{message}</p>
            <p className="text-cream/60 text-xs leading-relaxed mt-3">
              Not there in a few minutes? Check your spam folder. The link expires in 48 hours.
            </p>
            <button
              type="button"
              onClick={() => { setStatus('idle'); setMessage('') }}
              className="mt-4 text-gold text-xs font-bold uppercase tracking-widest underline underline-offset-4 hover:text-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form
            key="form"
            onSubmit={handleSubmit}
            aria-busy={status === 'loading'}
            aria-describedby={noteId}
            className="max-w-md mx-auto"
            noValidate
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 group">
                <input
                  type="email"
                  aria-label="Newsletter email address"
                  autoComplete="email"
                  maxLength={254}
                  name="email"
                  placeholder="Your email address"
                  required
                  aria-invalid={status === 'error' || undefined}
                  className="w-full bg-white/[0.06] border border-cream/25 text-cream placeholder:text-cream/45 px-4 py-3 text-base sm:text-sm focus:outline-none focus:border-gold/80 focus:bg-white/[0.09] transition-all duration-200"
                />
                {/* Animated bottom border on focus */}
                <span className="absolute bottom-0 left-0 h-px w-0 bg-gold group-focus-within:w-full transition-all duration-300 ease-out" />
              </div>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="bg-gold text-navy px-7 py-3 text-xs font-bold uppercase tracking-widest hover:bg-gold-light disabled:opacity-60 whitespace-nowrap btn-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
              >
                {status === 'loading' ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block w-3 h-3 border border-navy/40 border-t-navy rounded-full animate-spin [animation-duration:0.8s]"
                    />
                    Subscribing
                  </span>
                ) : (
                  'Subscribe'
                )}
              </button>
            </div>

            <div className="mt-4 flex items-start gap-3 text-left">
              <input
                id={alertsId}
                type="checkbox"
                name="alerts"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#c9a227] cursor-pointer"
              />
              <label htmlFor={alertsId} className="text-cream/75 text-xs leading-relaxed cursor-pointer">
                Also send me occasional special-article alerts (optional, at most one a week).
              </label>
            </div>

            {/* Honeypot: hidden from people and assistive technology; only bots fill it in. */}
            <div aria-hidden="true" className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden">
              <label>
                Leave this field empty
                <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>

            <p id={noteId} className="text-cream/55 text-xs leading-relaxed mt-4 text-left sm:text-center">
              We will email you once to confirm; nothing else is sent until you do. Unsubscribe or change topics
              from any email. See our{' '}
              <a href="/privacy#newsletter" className="text-gold/80 hover:text-gold underline transition-colors">
                Privacy Policy
              </a>
              . Already subscribed?{' '}
              <a href="/newsletter/manage" className="text-gold/80 hover:text-gold underline transition-colors">
                Manage preferences
              </a>
              .
            </p>
          </form>
        )}

        {status === 'error' && (
          <p key="error" role="alert" className="newsletter-error-in text-red-300 text-xs mt-4">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
