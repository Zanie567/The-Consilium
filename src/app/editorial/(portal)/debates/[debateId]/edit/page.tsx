'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface DebateData {
  id: string
  title: string
  description: string | null
  isActive: boolean
  closesAt: string | null
}

export default function EditDebatePage({ params }: { params: Promise<{ debateId: string }> }) {
  const router = useRouter()
  const [debateId, setDebateId] = useState<string | null>(null)
  const [data, setData] = useState<DebateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    params.then((p) => setDebateId(p.debateId))
  }, [params])

  const fetchData = useCallback(async (id: string) => {
    const res = await fetch(`/api/editorial/debates/${id}`)
    if (res.ok) {
      const json = await res.json()
      setData({ id: json.id, title: json.title, description: json.description, isActive: json.isActive, closesAt: json.closesAt })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (debateId) fetchData(debateId)
  }, [debateId, fetchData])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!data) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/editorial/debates/${data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.title,
        description: data.description || null,
        isActive: data.isActive,
        closesAt: data.closesAt || null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const json = await res.json()
      setError(json.error ?? 'Failed to save.')
    } else {
      setSuccess(true)
      setTimeout(() => router.push('/editorial/debates'), 800)
    }
  }

  if (loading) return <div className="p-8 text-[var(--fg-faint)] text-sm">Loading…</div>
  if (!data) return <div className="p-8 text-red-600 text-sm">Debate not found.</div>

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <button
          onClick={() => router.push('/editorial/debates')}
          className="text-[var(--fg-faint)] text-xs hover:text-gold transition-colors"
        >
          ← All Debates
        </button>
        <h1 className="text-2xl font-bold text-[var(--fg)] mt-2" style={{ fontFamily: 'var(--font-serif)' }}>
          Edit Debate
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest mb-1.5">
            Title
          </label>
          <input
            type="text"
            value={data.title}
            onChange={(e) => setData({ ...data, title: e.target.value })}
            required
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--fg)] text-sm p-3 focus:outline-none focus:border-gold transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest mb-1.5">
            Description
          </label>
          <textarea
            value={data.description ?? ''}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            rows={3}
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--fg)] text-sm p-3 resize-none focus:outline-none focus:border-gold transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest mb-1.5">
            Closes At (optional)
          </label>
          <input
            type="datetime-local"
            value={data.closesAt ? data.closesAt.slice(0, 16) : ''}
            onChange={(e) => setData({ ...data, closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--fg)] text-sm p-3 focus:outline-none focus:border-gold transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 p-4 bg-[var(--bg-subtle)] border border-[var(--border)]">
          <input
            id="isActive"
            type="checkbox"
            checked={data.isActive}
            onChange={(e) => setData({ ...data, isActive: e.target.checked })}
            className="w-4 h-4 accent-gold"
          />
          <label htmlFor="isActive" className="text-sm text-[var(--fg)] font-semibold cursor-pointer">
            Active (shown on homepage)
          </label>
          <p className="text-[var(--fg-faint)] text-xs ml-2">Activating will deactivate all other debates.</p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && <p className="text-green-600 text-sm">Saved! Redirecting…</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-navy text-cream text-xs font-bold uppercase tracking-widest px-6 py-3 hover:bg-navy/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/editorial/debates')}
            className="text-xs font-semibold text-[var(--fg-faint)] hover:text-[var(--fg)] px-4 py-3 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
