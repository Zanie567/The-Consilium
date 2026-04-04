'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

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
      router.push('/admin')
    }
  }

  return (
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
          className="w-full bg-white/10 border border-cream/20 px-4 py-3 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
          placeholder="editor@example.com"
        />
      </div>

      <div>
        <label className="block text-cream/70 text-xs font-bold uppercase tracking-widest mb-2">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full bg-white/10 border border-cream/20 px-4 py-3 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gold text-navy py-3 text-sm font-bold uppercase tracking-widest hover:bg-gold-light transition-colors disabled:opacity-60"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  )
}
