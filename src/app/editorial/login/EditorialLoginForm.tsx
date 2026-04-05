'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export function EditorialLoginForm() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
      callbackUrl: '/editorial',
    })
    setLoading(false)
    if (!res?.ok) {
      setError('Invalid email or password.')
      return
    }
    router.push('/editorial')
    router.refresh()
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetLoading(true)
    await fetch('/api/editorial/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: resetEmail }),
    })
    setResetLoading(false)
    setResetSent(true)
  }

  if (showReset) {
    return (
      <div className="space-y-4">
        {resetSent ? (
          <div className="text-center">
            <p className="text-cream/70 text-sm mb-4">
              If that email is registered, you&apos;ll receive a reset link shortly.
            </p>
            <button
              onClick={() => { setShowReset(false); setResetSent(false) }}
              className="text-gold text-xs hover:underline"
            >
              ← Back to login
            </button>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-cream/60 text-xs text-center mb-2">
              Enter your editorial email address.
            </p>
            <input
              type="email"
              required
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full bg-white/5 border border-white/10 focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={resetLoading}
              className="w-full bg-gold text-navy py-2.5 text-sm font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
            >
              {resetLoading ? 'Sending…' : 'Send Reset Link'}
            </button>
            <button
              type="button"
              onClick={() => setShowReset(false)}
              className="w-full text-cream/40 text-xs hover:text-cream/70 transition-colors"
            >
              ← Back to login
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      {error && (
        <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-4 py-3 text-center">
          {error}
        </p>
      )}
      <div>
        <label className="block text-cream/50 text-xs uppercase tracking-widest mb-1.5">
          Email
        </label>
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="w-full bg-white/5 border border-white/10 focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
          placeholder="your@email.com"
        />
      </div>
      <div>
        <label className="block text-cream/50 text-xs uppercase tracking-widest mb-1.5">
          Password
        </label>
        <input
          type="password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="w-full bg-white/5 border border-white/10 focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gold text-navy py-2.5 text-sm font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>
      <div className="text-center">
        <button
          type="button"
          onClick={() => setShowReset(true)}
          className="text-cream/30 text-xs hover:text-cream/60 transition-colors"
        >
          Forgot password?
        </button>
      </div>
    </form>
  )
}
