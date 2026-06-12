'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export function LoginForm({
  callbackUrl = '/',
  initialError,
}: {
  callbackUrl?: string
  initialError?: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(initialError ?? '')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    if (result?.error) {
      setError('Invalid email or password.')
      setLoading(false)
    } else {
      // Hard navigation bypasses the Next.js router cache so the dashboard
      // always loads fresh with the new session.
      window.location.replace(callbackUrl)
    }
  }

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    // OAuth sign-in redirects the page entirely. The loading state resets
    // on the rare chance the redirect does not happen.
    await signIn('google', { callbackUrl })
    setGoogleLoading(false)
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white/5 border border-cream/10 p-8 space-y-5"
      >
        {error && (
          <div className="bg-red-900/20 border border-red-500/30 px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-cream/70 text-xs font-bold uppercase tracking-widest mb-2">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-white/10 border border-cream/20 px-4 py-3 text-cream text-base sm:text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
            placeholder="editor@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-cream/70 text-xs font-bold uppercase tracking-widest">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-gold/60 text-xs hover:text-gold transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-white/10 border border-cream/20 px-4 py-3 pr-11 text-cream text-base sm:text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-cream/40 hover:text-cream/70 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gold text-navy py-3 text-sm font-bold uppercase tracking-widest hover:bg-gold-light transition-colors disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="relative flex items-center gap-4">
        <div className="flex-1 h-px bg-cream/10" />
        <span className="text-cream/30 text-xs uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-cream/10" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={googleLoading}
        className="w-full bg-white/5 border border-cream/10 px-4 py-3 text-cream text-sm font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-60 flex items-center justify-center gap-3"
      >
        <GoogleIcon />
        {googleLoading ? 'Redirecting...' : 'Continue with Google'}
      </button>
    </div>
  )
}
