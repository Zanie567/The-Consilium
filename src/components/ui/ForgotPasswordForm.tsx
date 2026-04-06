'use client'

import { useState } from 'react'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setLoading(false)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="bg-white/5 border border-cream/10 p-8 text-center">
        <p className="text-cream text-sm leading-relaxed">
          If an account with that email exists, we&apos;ve sent a reset link. Check your inbox.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/5 border border-cream/10 p-8 space-y-5">
      <p className="text-cream/60 text-sm">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>

      <div>
        <label className="block text-cream/70 text-xs font-bold uppercase tracking-widest mb-2">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full bg-white/10 border border-cream/20 px-4 py-3 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
          placeholder="you@example.com"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gold text-navy py-3 text-sm font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
      >
        {loading ? 'Sending...' : 'Send Reset Link'}
      </button>
    </form>
  )
}
