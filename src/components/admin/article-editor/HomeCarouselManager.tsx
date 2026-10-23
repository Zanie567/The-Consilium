'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react'

interface CarouselArticle {
  id: string
  title: string
  slug: string
}
interface CarouselResponse {
  articles: CarouselArticle[]
  selected: string[]
  configured: boolean
  message: string
  error?: string
}

export function HomeCarouselManager({ articleId }: { articleId?: string }) {
  const [articles, setArticles] = useState<CarouselArticle[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [addId, setAddId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    const response = await fetch('/api/editorial/homepage-carousel', { cache: 'no-store' })
    const data = (await response.json()) as CarouselResponse
    if (!response.ok) throw new Error(data.error || 'Cannot load carousel settings.')
    setArticles(data.articles)
    setSelected(data.selected)
    setNotice(data.message)
    setError('')
  }

  useEffect(() => {
    let active = true
    void fetch('/api/editorial/homepage-carousel', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as CarouselResponse
        if (!response.ok) throw new Error(data.error || 'Carousel management is restricted.')
        if (!active) return
        setArticles(data.articles)
        setSelected(data.selected)
        setNotice(data.message)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load carousel.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const changeOrder = (index: number, direction: -1 | 1) => {
    const next = [...selected]
    const other = index + direction
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other], next[index]]
    setSelected(next)
  }

  const persist = async (reset = false) => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/editorial/homepage-carousel', {
        method: reset ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        ...(!reset && { body: JSON.stringify({ ids: selected }) }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(data.error || 'Could not save carousel.')
      await refresh()
      setNotice(reset
        ? 'Automatic newest-first carousel restored.'
        : 'Order saved. The next newly published article will restore automatic newest-first ordering.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save carousel.')
    } finally {
      setSaving(false)
    }
  }

  const canAdd = selected.length < 3
  const available = articles.filter((article) => !selected.includes(article.id))

  return (
    <section className="border-t border-[var(--border)] pt-4 mt-4" aria-label="Homepage carousel management">
      <h3 className="text-xs font-semibold text-[var(--fg)] mb-1">Homepage carousel</h3>
      <p className="text-[11px] leading-snug text-[var(--fg-faint)] mb-3">
        Three slots. Newest published articles are the default. Manual ordering lasts until the next new publication.
      </p>
      {loading ? <p className="text-xs text-[var(--fg-muted)]">Loading carousel…</p> : null}
      {!loading && !error && selected.length === 0 ? (
        <p className="text-xs text-[var(--fg-faint)]">No published articles available.</p>
      ) : null}
      {!loading && articles.length > 0 && (
        <>
          <ol className="space-y-1.5" aria-label="Carousel articles in display order">
            {selected.map((id, index) => {
              const article = articles.find((item) => item.id === id)
              if (!article) return null
              return (
                <li key={id} className="p-2 border border-[var(--border)] rounded bg-[var(--bg-elevated)]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gold shrink-0">{index + 1}</span>
                    <span className="text-[11px] leading-snug text-[var(--fg)] flex-1 min-w-0">
                      {article.title}
                      {articleId === id && <span className="block text-gold">This article is on the carousel</span>}
                    </span>
                    <button type="button" onClick={() => changeOrder(index, -1)} disabled={saving || index === 0}
                      aria-label={`Move ${article.title} up`} className="p-1 disabled:opacity-30"><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => changeOrder(index, 1)} disabled={saving || index === selected.length - 1}
                      aria-label={`Move ${article.title} down`} className="p-1 disabled:opacity-30"><ArrowDown size={13} /></button>
                    <button type="button" onClick={() => setSelected((items) => items.filter((item) => item !== id))}
                      disabled={saving || selected.length <= 1} aria-label={`Remove ${article.title} from carousel`}
                      className="p-1 text-red-600 disabled:opacity-30"><Trash2 size={13} /></button>
                  </div>
                </li>
              )
            })}
          </ol>
          {canAdd && available.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              <select aria-label="Article to add to homepage carousel" className="text-[11px] flex-1 min-w-0 border rounded bg-[var(--bg)] border-[var(--border)] p-1"
                value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">Choose a published article…</option>
                {available.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
              </select>
              <button type="button" aria-label="Add selected article" disabled={!addId || saving}
                className="p-1.5 border border-[var(--border)] rounded disabled:opacity-30"
                onClick={() => { if (addId) { setSelected((items) => [...items, addId]); setAddId('') } }}><Plus size={14} /></button>
            </div>
          )}
          <div className="flex gap-1.5 mt-3">
            <button type="button" disabled={saving || selected.length === 0}
              onClick={() => void persist()} className="flex-1 bg-navy text-gold border border-gold/30 px-2 py-2 rounded text-[11px] font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save carousel order'}
            </button>
            <button type="button" disabled={saving} onClick={() => void persist(true)}
              aria-label="Restore newest-first carousel" title="Restore automatic newest-first carousel"
              className="p-2 border border-[var(--border)] rounded disabled:opacity-50"><RefreshCw size={13} /></button>
          </div>
          {notice && <p role="status" className="text-[10px] text-[var(--fg-muted)] mt-2">{notice}</p>}
        </>
      )}
      {error && <p role="alert" className="text-[11px] text-red-600 mt-2">{error}</p>}
    </section>
  )
}
