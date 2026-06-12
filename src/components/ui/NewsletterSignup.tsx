'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export function NewsletterSignup() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus('success')
        setMessage('Thank you for subscribing to The Consilium.')
        setEmail('')
      } else {
        setStatus('error')
        setMessage(data.error || 'Something went wrong. Please try again.')
      }
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  return (
    <section className="bg-navy py-20 px-4 relative overflow-hidden">
      {/* Subtle background texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #c9a227 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative max-w-2xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
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
            Receive our latest articles and analysis directly in your inbox.
            Join the conversation on economics, policy, and ideas.
          </p>
          <p className="text-cream/35 text-xs mb-6">
            We respect your privacy.{' '}
            <a href="/privacy" className="text-gold/70 hover:text-gold underline transition-colors">
              Read our Privacy Policy
            </a>
            .
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {status === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="border border-gold/40 bg-gold/10 px-8 py-5 text-gold text-sm font-medium tracking-wide"
            >
              ✓ &nbsp;{message}
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="relative flex-1 group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  required
                  className="w-full bg-white/[0.06] border border-cream/20 text-cream placeholder:text-cream/35 px-4 py-3 text-base sm:text-sm focus:outline-none focus:border-gold/70 focus:bg-white/[0.09] transition-all duration-200"
                />
                {/* Animated bottom border on focus */}
                <span className="absolute bottom-0 left-0 h-px w-0 bg-gold group-focus-within:w-full transition-all duration-300 ease-out" />
              </div>
              <motion.button
                type="submit"
                disabled={status === 'loading'}
                className="bg-gold text-navy px-7 py-3 text-xs font-bold uppercase tracking-widest hover:bg-gold-light disabled:opacity-60 whitespace-nowrap btn-lift"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {status === 'loading' ? (
                  <span className="inline-flex items-center gap-2">
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                      className="inline-block w-3 h-3 border border-navy/40 border-t-navy rounded-full"
                    />
                    Subscribing
                  </span>
                ) : 'Subscribe'}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {status === 'error' && (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-red-400 text-xs mt-4"
            >
              {message}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
