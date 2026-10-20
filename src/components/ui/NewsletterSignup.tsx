'use client'

import { useRef, useState } from 'react'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { apiRequest, asApiError } from '@/lib/apiClient'

// Same rule as /api/subscribe, so an address the server would reject is never sent.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function NewsletterSignup() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  // A ref, not `status`: a second submit can arrive before React re-renders the disabled button.
  const inFlight = useRef(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    // Read the visible form value, including autofill and input before hydration.
    const email = String(new FormData(e.currentTarget as HTMLFormElement).get('email') ?? '').trim()
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      setStatus('error')
      setMessage('Enter a valid email address.')
      return
    }
    inFlight.current = true
    setStatus('loading')
    try {
      await apiRequest('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      setStatus('success')
      setMessage('Thank you for subscribing to The Consilium.')
    } catch (reason) {
      setStatus('error')
      setMessage(asApiError(reason).status === 400 ? 'Enter a valid email address.' : asApiError(reason).status === 429 ? asApiError(reason).message : 'Unable to subscribe right now. Please try again.')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <section className="bg-navy py-20 px-4 relative overflow-hidden">
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
          <p className="text-gold/70 text-[0.65rem] tracking-[0.35em] uppercase mb-3 font-semibold">
            Stay Informed
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold text-cream mb-4 leading-tight"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Subscribe to The Consilium
          </h2>
          <div className="w-12 h-px bg-gold/40 mx-auto mb-6" />
          <p className="text-cream/55 mb-6 text-sm leading-relaxed max-w-sm mx-auto">
            Receive our latest articles and analysis directly in your inbox. Join the conversation
            on economics, policy, and ideas.
          </p>
          <p className="text-cream/35 text-xs mb-6">
            We respect your privacy.{' '}
            <a href="/privacy" className="text-gold/70 hover:text-gold underline transition-colors">
              Read our Privacy Policy
            </a>
            .
          </p>
        </AnimateIn>

          {status === 'success' ? (
            <div
              key="success"
              role="status"
              className="newsletter-success-in border border-gold/40 bg-gold/10 px-8 py-5 text-gold text-sm font-medium tracking-wide"
            >
              ✓ &nbsp;{message}
            </div>
          ) : (
            <form
              key="form"
              onSubmit={handleSubmit}
              aria-busy={status === 'loading'}
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
            >
              <div className="relative flex-1 group">
                <input
                  type="email"
                  aria-label="Newsletter email address"
                  autoComplete="email"
                  maxLength={254}
                  name="email"
                  placeholder="Your email address"
                  required
                  className="w-full bg-white/[0.06] border border-cream/20 text-cream placeholder:text-cream/35 px-4 py-3 text-base sm:text-sm focus:outline-none focus:border-gold/70 focus:bg-white/[0.09] transition-all duration-200"
                />
                {/* Animated bottom border on focus */}
                <span className="absolute bottom-0 left-0 h-px w-0 bg-gold group-focus-within:w-full transition-all duration-300 ease-out" />
              </div>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="bg-gold text-navy px-7 py-3 text-xs font-bold uppercase tracking-widest hover:bg-gold-light disabled:opacity-60 whitespace-nowrap btn-lift"
              >
                {status === 'loading' ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 border border-navy/40 border-t-navy rounded-full animate-spin [animation-duration:0.8s]"
                    />
                    Subscribing
                  </span>
                ) : (
                  'Subscribe'
                )}
              </button>
            </form>
          )}

          {status === 'error' && (
            <p
              key="error"
              role="alert"
              className="newsletter-error-in text-red-400 text-xs mt-4"
            >
              {message}
            </p>
          )}
      </div>
    </section>
  )
}
