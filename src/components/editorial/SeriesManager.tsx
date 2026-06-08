'use client'

import { useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'

interface SeriesArticle {
  id: string
  title: string
  slug: string
  seriesOrder: number | null
}

interface SeriesRecord {
  id: string
  title: string
  slug: string
  description: string | null
  articles: SeriesArticle[]
}

interface ArticleOption {
  id: string
  title: string
  seriesId: string | null
  seriesOrder: number | null
}

interface Props {
  initialSeries: SeriesRecord[]
  articles: ArticleOption[]
}

export function SeriesManager({ initialSeries, articles }: Props) {
  const [series, setSeries] = useState(initialSeries)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newSeries, setNewSeries] = useState({ title: '', description: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const createSeries = async () => {
    if (!newSeries.title.trim()) { setError('Title is required.'); return }
    setLoading(true)
    const res = await fetch('/api/editorial/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSeries),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error ?? 'Failed.'); return }
    setSeries((prev) => [{ ...data, articles: [] }, ...prev])
    setNewSeries({ title: '', description: '' })
    setShowCreate(false)
    setError('')
  }

  const assignArticle = async (articleId: string, seriesId: string, order: number) => {
    await fetch(`/api/articles/${articleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId, seriesOrder: order }),
    })
    window.location.reload()
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-red-500 text-sm bg-red-500/10 border border-red-500/20 px-4 py-3">{error}</p>
      )}

      <div className="flex justify-between items-center">
        <p className="text-[var(--fg-faint)] text-sm">{series.length} series</p>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 bg-navy text-gold px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
        >
          <Plus size={13} />
          New Series
        </button>
      </div>

      {showCreate && (
        <div className="bg-[var(--bg-elevated)] border border-gold/20 p-5 space-y-3">
          <p className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">New Series</p>
          <input
            type="text"
            value={newSeries.title}
            onChange={(e) => setNewSeries({ ...newSeries, title: e.target.value })}
            placeholder="e.g. UK Housing Policy"
            className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
          />
          <textarea
            value={newSeries.description}
            onChange={(e) => setNewSeries({ ...newSeries, description: e.target.value })}
            placeholder="Brief description (optional)"
            rows={2}
            className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold resize-none"
          />
          <div className="flex gap-3">
            <button
              onClick={createSeries}
              disabled={loading}
              className="bg-gold text-navy px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="border border-[var(--border)] text-[var(--fg-muted)] px-4 py-2 text-xs font-bold uppercase tracking-widest"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {series.length === 0 && (
          <div className="text-center py-16 border border-dashed border-[var(--border)]">
            <p className="text-[var(--fg)] text-sm font-semibold mb-1">No series yet</p>
            <p className="text-[var(--fg-faint)] text-sm">
              Create a series above to group related articles into an ordered collection.
            </p>
          </div>
        )}
        {series.map((s) => (
          <div key={s.id} className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setExpanded((e) => (e === s.id ? null : s.id))}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--bg-subtle)] transition-colors text-left"
            >
              <div>
                <p className="font-semibold text-[var(--fg)] text-sm">{s.title}</p>
                <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                  {s.articles.length} article{s.articles.length !== 1 ? 's' : ''}
                  {s.description && ` · ${s.description}`}
                </p>
              </div>
              {expanded === s.id ? <ChevronUp size={16} className="text-[var(--fg-faint)]" /> : <ChevronDown size={16} className="text-[var(--fg-faint)]" />}
            </button>

            {expanded === s.id && (
              <div className="border-t border-[var(--border)] p-5 space-y-4">
                {/* Current articles */}
                {s.articles.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">Articles in series</p>
                    <div className="space-y-1">
                      {s.articles.map((a, i) => (
                        <div key={a.id} className="flex items-center gap-3 text-sm">
                          <span className="text-[var(--fg-faint)] text-xs w-6 text-right shrink-0">
                            {a.seriesOrder ?? i + 1}
                          </span>
                          <span className="text-[var(--fg)] flex-1">{a.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assign article */}
                <div>
                  <p className="text-xs font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-2">Add article</p>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-xs focus:outline-none focus:border-gold"
                      defaultValue=""
                      id={`assign-${s.id}`}
                    >
                      <option value="" disabled>Select an article…</option>
                      {articles
                        .filter((a) => !a.seriesId || a.seriesId === s.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>{a.title}</option>
                        ))}
                    </select>
                    <button
                      onClick={() => {
                        const sel = document.getElementById(`assign-${s.id}`) as HTMLSelectElement
                        if (!sel.value) return
                        assignArticle(sel.value, s.id, s.articles.length + 1)
                      }}
                      className="bg-navy text-gold px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
