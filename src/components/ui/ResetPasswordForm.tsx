'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Props {
  token: string
  /** API path to call - /api/auth/forgot-password (public) or /api/editorial/password-reset (editorial) */
  apiPath: string
}

export function ResetPasswordForm({ token, apiPath }: Props) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch(apiPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.')
      setLoading(false)
      return
    }
    setDone(true)
    setTimeout(() => router.push('/login'), 2000)
  }

  if (done) {
    return (
      <div className="bg-white/5 border border-cream/10 p-8 text-center">
        <p className="text-cream text-sm">Password updated. Redirecting to sign in&hellip;</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/5 border border-cream/10 p-8 space-y-5">
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-cream/70 text-xs font-bold uppercase tracking-widest mb-2">
          New Password
        </label>
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-white/10 border border-cream/20 px-4 py-3 pr-11 text-cream text-base sm:text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-cream/40 hover:text-cream/70 transition-colors"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gold text-navy py-3 text-sm font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
      >
        {loading ? 'Updating...' : 'Set New Password'}
      </button>
    </form>
  )
}
