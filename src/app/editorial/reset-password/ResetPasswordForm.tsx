'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    try {
    const res = await fetch('/api/editorial/password-reset', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Reset failed.'); return }
    router.push('/editorial/login')
    } catch { setError('Reset could not reach the server. Check your connection and try again.') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-4 py-3">
          {error}
        </p>
      )}
      <div>
        <label htmlFor="editorial-reset-password" className="block text-cream/50 text-xs uppercase tracking-widest mb-1.5">
          New Password
        </label>
        <input
          id="editorial-reset-password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-white/5 border border-white/10 focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
          placeholder="Min. 8 characters"
        />
      </div>
      <div>
        <label htmlFor="editorial-reset-confirm" className="block text-cream/50 text-xs uppercase tracking-widest mb-1.5">
          Confirm Password
        </label>
        <input
          id="editorial-reset-confirm"
          type="password"
          required
          minLength={8}
          maxLength={128}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full bg-white/5 border border-white/10 focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gold text-navy py-2.5 text-sm font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
      >
        {loading ? 'Resetting…' : 'Reset Password'}
      </button>
    </form>
  )
}
