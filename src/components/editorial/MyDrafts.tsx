'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { FileText, Trash2, PlusCircle, Clock, AlignLeft } from 'lucide-react'

interface Draft {
  id: string
  title: string
  excerpt: string | null
  updatedAt: string
  wordCount: number
  category: { id: string; name: string } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Re-export the SWR key so the editor can trigger a revalidation after autosave
export const DRAFTS_SWR_KEY = '/api/articles?mine=true&status=DRAFT'

function RelativeTime({ dateStr }: { dateStr: string }) {
  const [label, setLabel] = useState(() =>
    formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  )

  useEffect(() => {
    const tick = () => setLabel(formatDistanceToNow(new Date(dateStr), { addSuffix: true }))
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [dateStr])

  return <span>{label}</span>
}

function DraftCard({ draft, onDeleted }: { draft: Draft; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [gone, setGone] = useState(false)

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/articles/${draft.id}`, { method: 'DELETE' })
      if (res.ok) {
        setGone(true)
        // Wait for fade-out, then remove from list
        setTimeout(() => onDeleted(draft.id), 350)
      }
    } finally {
      setDeleting(false)
    }
  }, [draft.id, onDeleted])

  return (
    <div
      className="group relative bg-[var(--bg-elevated)] border border-[var(--border)] p-4 transition-all duration-300"
      style={{ opacity: gone ? 0 : 1 }}
    >
      {/* Headline */}
      <Link href={`/editorial/articles/${draft.id}/edit`} className="block mb-2">
        <p className={`text-sm font-semibold leading-snug line-clamp-2 group-hover:text-gold transition-colors ${
          draft.title ? 'text-[var(--fg)]' : 'text-[var(--fg-faint)] italic'
        }`}>
          {draft.title || 'Untitled document'}
        </p>
      </Link>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
        {draft.category && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-gold/70 bg-gold/8 px-1.5 py-0.5 rounded-sm">
            {draft.category.name}
          </span>
        )}
        <span className="flex items-center gap-1 text-[11px] text-[var(--fg-faint)]">
          <Clock size={10} />
          Saved <RelativeTime dateStr={draft.updatedAt} />
        </span>
        {draft.wordCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--fg-faint)]">
            <AlignLeft size={10} />
            {draft.wordCount.toLocaleString()} words
          </span>
        )}
      </div>

      {/* Action row */}
      {confirming ? (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] text-[var(--fg-muted)]">Delete this draft?</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[11px] font-semibold text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-[11px] text-[var(--fg-faint)] hover:text-[var(--fg-muted)] transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Link
            href={`/editorial/articles/${draft.id}/edit`}
            className="text-[11px] font-semibold text-gold hover:text-gold/80 transition-colors"
          >
            Continue editing →
          </Link>
          <button
            onClick={() => setConfirming(true)}
            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[var(--fg-faint)] hover:text-red-500 hover:bg-red-500/8 transition-colors"
            aria-label="Delete draft"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

export function MyDrafts() {
  const { data, isLoading, mutate } = useSWR<Draft[]>(DRAFTS_SWR_KEY, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  const [localDrafts, setLocalDrafts] = useState<Draft[] | null>(null)

  // Sync SWR data into local state (allows optimistic removal on delete)
  useEffect(() => {
    if (data) setLocalDrafts(data)
  }, [data])

  const handleDeleted = useCallback((id: string) => {
    setLocalDrafts((prev) => prev?.filter((d) => d.id !== id) ?? null)
    mutate()
  }, [mutate])

  const drafts = localDrafts ?? data ?? []

  if (isLoading && !data) {
    return (
      <section className="mb-8">
        <div className="h-5 w-32 bg-[var(--bg-subtle)] rounded animate-pulse mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-[var(--bg-subtle)] rounded animate-pulse" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest flex items-center gap-2">
          <FileText size={13} className="text-[var(--fg-faint)]" />
          My Drafts
          {drafts.length > 0 && (
            <span className="bg-[var(--bg-subtle)] text-[var(--fg-faint)] text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {drafts.length}
            </span>
          )}
        </h2>
        <Link
          href="/editorial/articles/new"
          className="flex items-center gap-1 text-[11px] font-semibold text-gold hover:text-gold/80 transition-colors"
        >
          <PlusCircle size={12} />
          New Article
        </Link>
      </div>

      {drafts.length === 0 ? (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-6 py-10 text-center">
          <p className="text-[var(--fg-faint)] text-sm mb-4 leading-relaxed">
            No drafts yet. Start a new article and your work will be saved here automatically.
          </p>
          <Link
            href="/editorial/articles/new"
            className="inline-flex items-center gap-2 bg-navy text-gold px-5 py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
          >
            <PlusCircle size={14} />
            New Article
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 shadow-[var(--shadow-card)]">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} onDeleted={handleDeleted} />
          ))}
        </div>
      )}
    </section>
  )
}
