'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function SignUpForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreed, setAgreed] = useState(false)
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
      body: JSON.stringify({ name, email, password, agreed }),
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
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-[var(--bg)] border border-[var(--border)] px-4 py-3 pr-11 text-[var(--fg)] text-sm placeholder:text-[var(--fg-faint)] focus:outline-none focus:border-gold transition-colors"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] hover:text-[var(--fg-muted)] transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            required
            className="mt-0.5 w-4 h-4 shrink-0 accent-navy cursor-pointer"
          />
          <span className="text-[var(--fg-muted)] text-xs leading-relaxed">
            I have read and agree to the{' '}
            <Link href="/privacy" className="text-gold hover:underline" target="_blank">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link href="/terms" className="text-gold hover:underline" target="_blank">
              Terms of Service
            </Link>
            .
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={loading || !agreed}
        className="w-full bg-navy text-gold py-3 text-sm font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  )
}
