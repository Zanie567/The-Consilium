'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function SetupForm() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const res = await fetch('/api/editorial/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, email: form.email, password: form.password }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? 'Setup failed.')
      return
    }
    router.push('/editorial/login')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-4 py-3">
          {error}
        </p>
      )}
      <div>
        <label className="block text-cream/60 text-xs uppercase tracking-widest mb-1.5">
          Full Name
        </label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full bg-navy-light border border-navy-light focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
          placeholder="Your name"
        />
      </div>
      <div>
        <label className="block text-cream/60 text-xs uppercase tracking-widest mb-1.5">
          Email
        </label>
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="w-full bg-navy-light border border-navy-light focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
          placeholder="admin@example.com"
        />
      </div>
      <div>
        <label className="block text-cream/60 text-xs uppercase tracking-widest mb-1.5">
          Password
        </label>
        <input
          type="password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="w-full bg-navy-light border border-navy-light focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
          placeholder="Min. 8 characters"
        />
      </div>
      <div>
        <label className="block text-cream/60 text-xs uppercase tracking-widest mb-1.5">
          Confirm Password
        </label>
        <input
          type="password"
          required
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          className="w-full bg-navy-light border border-navy-light focus:border-gold px-4 py-2.5 text-cream text-sm outline-none transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gold text-navy py-2.5 text-sm font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60 mt-2"
      >
        {loading ? 'Creating account…' : 'Create Admin Account'}
      </button>
    </form>
  )
}
