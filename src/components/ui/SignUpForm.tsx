'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

export function SignUpForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
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

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true)
    await signIn('google', { callbackUrl: '/' })
    setGoogleLoading(false)
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleGoogleSignUp}
        disabled={googleLoading}
        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-3 text-[var(--fg)] text-sm font-bold uppercase tracking-widest hover:bg-[var(--bg-hover,var(--bg-elevated))] transition-colors disabled:opacity-60 flex items-center justify-center gap-3 shadow-[var(--shadow-card)]"
      >
        <GoogleIcon />
        {googleLoading ? 'Redirecting...' : 'Continue with Google'}
      </button>

      <p className="text-center text-[var(--fg-faint)] text-xs">
        By continuing with Google you agree to our{' '}
        <Link href="/privacy" className="text-gold hover:underline" target="_blank">Privacy Policy</Link>{' '}
        and{' '}
        <Link href="/terms" className="text-gold hover:underline" target="_blank">Terms of Service</Link>.
      </p>

      <div className="relative flex items-center gap-4">
        <div className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-[var(--fg-faint)] text-xs uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>

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
    </div>
  )
}
