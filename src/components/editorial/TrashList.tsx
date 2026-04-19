'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Trash2, RotateCcw } from 'lucide-react'

export interface TrashedArticle {
  id: string
  title: string
  status: string
  deletedAt: string
  author: { name: string | null }
  category: { name: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending Review',
  PUBLISHED: 'Published',
  SCHEDULED: 'Scheduled',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
}

export function TrashList({ initialArticles }: { initialArticles: TrashedArticle[] }) {
  const [articles, setArticles] = useState<TrashedArticle[]>(initialArticles)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState('')

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  async function restore(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/editorial/trash/${id}`, { method: 'PATCH' })
      if (!res.ok) throw new Error()
      setArticles((prev) => prev.filter((a) => a.id !== id))
      showToast('Article restored successfully.')
    } catch {
      showToast('Failed to restore article.')
    } finally {
      setBusy(null)
    }
  }

  async function permanentDelete(id: string) {
    setBusy(id)
    setConfirmId(null)
    try {
      const res = await fetch(`/api/editorial/trash/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setArticles((prev) => prev.filter((a) => a.id !== id))
      showToast('Article permanently deleted.')
    } catch {
      showToast('Failed to permanently delete article.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-navy text-gold text-sm font-semibold px-5 py-3 shadow-lg border border-gold/30">
          {toastMsg}
        </div>
      )}

      {/* Confirm dialog */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl max-w-sm w-full mx-4 p-6">
            <h2
              className="text-lg font-bold text-[var(--fg)] mb-2"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Delete permanently?
            </h2>
            <p className="text-[var(--fg-muted)] text-sm mb-6">
              This cannot be undone. The article and all associated data will be removed forever.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmId(null)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => permanentDelete(confirmId)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 pl-10 md:pl-0">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Trash
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          {articles.length === 0
            ? 'Trash is empty.'
            : `${articles.length} deleted article${articles.length !== 1 ? 's' : ''}.`}
        </p>
      </div>

      {/* 30-day banner */}
      <div className="mb-6 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-amber-600 dark:text-amber-400 text-sm">
        <Trash2 size={16} className="shrink-0 mt-0.5" />
        <span>Items in trash are permanently deleted after 30&nbsp;days.</span>
      </div>

      {articles.length === 0 ? (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-6 py-20 text-center">
          <Trash2 size={32} className="mx-auto text-[var(--fg-faint)] mb-4 opacity-30" />
          <p className="text-[var(--fg-muted)] text-sm font-medium mb-1">Trash is empty.</p>
          <p className="text-[var(--fg-faint)] text-xs">
            Deleted articles are kept for 30&nbsp;days before being permanently removed.
          </p>
        </div>
      ) : (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
          {/* Column headers — desktop only */}
          <div className="hidden sm:grid grid-cols-[1fr_140px_120px_140px_auto] gap-4 px-5 py-2.5 border-b border-[var(--border)] bg-[var(--bg-subtle)]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">Article</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">Category</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">Was</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">Deleted</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">Actions</span>
          </div>

          {articles.map((article, i) => (
            <div
              key={article.id}
              className={`flex flex-col sm:grid sm:grid-cols-[1fr_140px_120px_140px_auto] sm:items-center gap-2 sm:gap-4 px-5 py-4 transition-colors ${
                i > 0 ? 'border-t border-[var(--border)]' : ''
              } ${
                busy === article.id
                  ? 'opacity-40 pointer-events-none'
                  : 'hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {/* Title + author */}
              <div className="min-w-0">
                <p
                  className="font-semibold text-[var(--fg)] text-sm line-clamp-2 sm:line-clamp-1"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {article.title || <span className="italic text-[var(--fg-faint)]">Untitled</span>}
                </p>
                <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                  {article.author.name ?? 'Unknown'}
                </p>
              </div>

              {/* Category */}
              <span className="text-[var(--fg-faint)] text-xs">
                {article.category?.name ?? <span className="italic">Uncategorised</span>}
              </span>

              {/* Original status */}
              <span className="text-[var(--fg-faint)] text-xs">
                {STATUS_LABEL[article.status] ?? article.status}
              </span>

              {/* How long ago */}
              <span className="text-[var(--fg-faint)] text-xs whitespace-nowrap">
                {formatDistanceToNow(new Date(article.deletedAt), { addSuffix: true })}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => restore(article.id)}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={11} />
                  <span>Restore</span>
                </button>
                <button
                  onClick={() => setConfirmId(article.id)}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border border-red-500/30 text-red-500/70 hover:border-red-500 hover:text-red-500 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={11} />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
