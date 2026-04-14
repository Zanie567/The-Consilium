'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function LoginForm({ redirectTo = '/editorial' }: { redirectTo?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      router.push(redirectTo)
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
            className="w-full bg-white/10 border border-cream/20 px-4 py-3 pr-11 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-gold transition-colors"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/40 hover:text-cream/70 transition-colors"
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
  )
}
