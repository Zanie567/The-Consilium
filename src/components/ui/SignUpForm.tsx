'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export function SignUpForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Something went wrong.')
      setLoading(false)
      return
    }

    // Auto sign-in after successful registration
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError('Account created but sign-in failed. Please sign in manually.')
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--bg-elevated)] border border-[var(--border)] p-8 space-y-5 shadow-[var(--shadow-card)]"
    >
      {error && (
        <div className="bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-500/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className="block text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest mb-2">
          Full Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-gold transition-colors"
          placeholder="Your name"
        />
      </div>

      <div>
        <label className="block text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest mb-2">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-gold transition-colors"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className="block text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest mb-2">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-gold transition-colors"
          placeholder="At least 8 characters"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-navy text-gold py-3 text-sm font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-60"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  )
}
