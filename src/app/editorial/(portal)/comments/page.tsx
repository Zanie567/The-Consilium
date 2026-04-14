'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Flag, EyeOff, CheckCircle } from 'lucide-react'

interface CommentRow {
  id: string
  body: string
  createdAt: string
  isReported: boolean
  isHidden: boolean
  upvotes: number
  user: { id: string; name: string | null }
  article: { id: string; title: string; slug: string }
}

interface Stats {
  total: number
  reported: number
  hidden: number
}

type Tab = 'reported' | 'recent' | 'hidden'

export default function CommentsPage() {
  const [tab, setTab] = useState<Tab>('reported')
  const [comments, setComments] = useState<CommentRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [stats, setStats] = useState<Stats>({ total: 0, reported: 0, hidden: 0 })
  const [loading, setLoading] = useState(true)
  const PER_PAGE = 30

  const fetchComments = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/editorial/comments?tab=${tab}&page=${page}`)
    if (res.ok) {
      const json = await res.json()
      setComments(json.comments)
      setTotal(json.total)
      setStats(json.stats)
    }
    setLoading(false)
  }, [tab, page])

  useEffect(() => { fetchComments() }, [fetchComments])
  useEffect(() => { setPage(0) }, [tab])

  async function handleAction(commentId: string, action: 'approve' | 'hide') {
    const res = await fetch(`/api/editorial/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) fetchComments()
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1
          className="text-2xl font-bold text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Comment Moderation
        </h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Comments', value: stats.total },
          { label: 'Reported', value: stats.reported, warn: stats.reported > 0 },
          { label: 'Hidden', value: stats.hidden },
        ].map((s) => (
          <div
            key={s.label}
            className={`bg-[var(--bg-elevated)] border p-5 shadow-[var(--shadow-card)] ${
              s.warn ? 'border-red-400' : 'border-[var(--border)]'
            }`}
          >
            <p className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest mb-1">{s.label}</p>
            <p
              className={`text-2xl font-bold ${s.warn ? 'text-red-500' : 'text-[var(--fg)]'}`}
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[var(--border)] mb-6">
        {(['reported', 'recent', 'hidden'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'text-gold border-gold'
                : 'text-[var(--fg-faint)] border-transparent hover:text-[var(--fg)]'
            }`}
          >
            {t === 'reported' ? `Reported (${stats.reported})` : t === 'hidden' ? `Hidden (${stats.hidden})` : 'Recent'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-[var(--border)] animate-pulse" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--border)]">
          <p className="text-[var(--fg-faint)] text-sm">No comments in this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`bg-[var(--bg-elevated)] border shadow-[var(--shadow-card)] p-5 ${
                comment.isReported ? 'border-red-300' : 'border-[var(--border)]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs font-semibold text-[var(--fg)]">
                      {comment.user.name ?? 'Anonymous'}
                    </span>
                    <span className="text-[var(--fg-faint)] text-[10px]">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </span>
                    <Link
                      href={`/articles/${comment.article.slug}`}
                      target="_blank"
                      className="text-[10px] text-gold hover:underline truncate max-w-[200px]"
                    >
                      {comment.article.title}
                    </Link>
                    {comment.isReported && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5">
                        <Flag size={9} /> Reported
                      </span>
                    )}
                    {comment.isHidden && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--fg-faint)] bg-[var(--bg-subtle)] px-2 py-0.5">
                        <EyeOff size={9} /> Hidden
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{comment.body}</p>
                  <p className="text-[10px] text-[var(--fg-faint)] mt-1">{comment.upvotes} upvote{comment.upvotes !== 1 ? 's' : ''}</p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  {comment.isReported && !comment.isHidden && (
                    <button
                      onClick={() => handleAction(comment.id, 'approve')}
                      className="flex items-center gap-1 text-[10px] font-bold text-green-600 hover:text-green-700 transition-colors"
                    >
                      <CheckCircle size={11} /> Approve
                    </button>
                  )}
                  {!comment.isHidden && (
                    <button
                      onClick={() => handleAction(comment.id, 'hide')}
                      className="flex items-center gap-1 text-[10px] font-bold text-[var(--fg-faint)] hover:text-red-500 transition-colors"
                    >
                      <EyeOff size={11} /> Hide
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-xs font-semibold text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-30 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-[var(--fg-faint)] text-xs">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs font-semibold text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
