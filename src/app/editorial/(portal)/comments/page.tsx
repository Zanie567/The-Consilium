'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Flag, EyeOff, CheckCircle, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react'

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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'reported', label: stats.reported > 0 ? `Reported (${stats.reported})` : 'Reported' },
    { key: 'recent', label: 'Recent' },
    { key: 'hidden', label: stats.hidden > 0 ? `Hidden (${stats.hidden})` : 'Hidden' },
  ]

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
        <div
          className="bg-white rounded-lg p-5 relative overflow-hidden hover:bg-[#faf8f0] transition-colors duration-150 cursor-default border border-[#e8e4d9]"
          style={{ borderLeft: '3px solid #1a2744' }}
        >
          <div className="absolute top-4 right-4 opacity-35 text-[#1a2744]">
            <MessageSquare size={20} />
          </div>
          <p className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] mb-3">Total Comments</p>
          <p className="text-[36px] font-semibold text-[#1a2744] leading-none mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {stats.total.toLocaleString()}
          </p>
          <p className="text-[12px] text-[#888]">across all articles</p>
        </div>

        <div
          className="bg-white rounded-lg p-5 relative overflow-hidden hover:bg-[#faf8f0] transition-colors duration-150 cursor-default border border-[#e8e4d9]"
          style={{ borderLeft: '3px solid #dc2626' }}
        >
          <div className="absolute top-4 right-4 opacity-35 text-[#dc2626]">
            <Flag size={20} />
          </div>
          <p className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] mb-3">Reported</p>
          <p className="text-[36px] font-semibold text-[#1a2744] leading-none mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {stats.reported.toLocaleString()}
          </p>
          <p className={`text-[12px] ${stats.reported > 0 ? 'text-amber-500 font-medium' : 'text-[#888]'}`}>
            {stats.reported > 0 ? 'need review' : 'nothing flagged'}
          </p>
        </div>

        <div
          className="bg-white rounded-lg p-5 relative overflow-hidden hover:bg-[#faf8f0] transition-colors duration-150 cursor-default border border-[#e8e4d9]"
          style={{ borderLeft: '3px solid #888' }}
        >
          <div className="absolute top-4 right-4 opacity-35 text-[#888]">
            <EyeOff size={20} />
          </div>
          <p className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] mb-3">Hidden</p>
          <p className="text-[36px] font-semibold text-[#1a2744] leading-none mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {stats.hidden.toLocaleString()}
          </p>
          <p className="text-[12px] text-[#888]">removed from public view</p>
        </div>
      </div>

      {/* Tabs — pill style */}
      <div className="flex items-center gap-1.5 mb-6">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[6px] transition-colors duration-150 ${
              tab === t.key
                ? 'bg-[#f0ede6] text-[#1a2744] border border-[#d0cdc5]/60'
                : 'text-[#888] hover:bg-[#f5f2eb] hover:text-[#1a2744]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-[#f0ede6] animate-pulse rounded-lg" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <MessageSquare size={32} className="text-[#ccc]" />
          <p className="text-[15px] font-semibold text-[#1a2744]">No comments in this view</p>
          <p className="text-[13px] text-[#888]">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`bg-white border rounded-lg p-5 hover:bg-[#faf8f4] transition-colors duration-100 ${
                comment.isReported ? 'border-[#fca5a5]' : 'border-[#e8e4d9]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-[#1a2744]">
                      {comment.user.name ?? 'Anonymous'}
                    </span>
                    <span className="text-[#888] text-[11px]">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </span>
                    <Link
                      href={`/articles/${comment.article.slug}`}
                      target="_blank"
                      className="text-[11px] text-[#c9a84c] hover:underline truncate max-w-[200px]"
                    >
                      {comment.article.title}
                    </Link>
                    {comment.isReported && (
                      <span className="bg-red-50 text-red-500 text-[10px] font-bold px-2 py-0.5 rounded-[4px] flex items-center gap-1">
                        <Flag size={9} /> Reported
                      </span>
                    )}
                    {comment.isHidden && (
                      <span className="bg-[#f0ede6] text-[#888] text-[10px] font-bold px-2 py-0.5 rounded-[4px] flex items-center gap-1">
                        <EyeOff size={9} /> Hidden
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#444] leading-relaxed">{comment.body}</p>
                  <p className="text-[11px] text-[#aaa] mt-1">{comment.upvotes} upvote{comment.upvotes !== 1 ? 's' : ''}</p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  {comment.isReported && !comment.isHidden && (
                    <button
                      onClick={() => handleAction(comment.id, 'approve')}
                      className="text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-[4px] transition-colors"
                    >
                      <CheckCircle size={11} /> Approve
                    </button>
                  )}
                  {!comment.isHidden && (
                    <button
                      onClick={() => handleAction(comment.id, 'hide')}
                      className="text-[12px] font-semibold text-[#888] hover:text-red-500 flex items-center gap-1.5 bg-[#f5f2eb] hover:bg-red-50 px-2.5 py-1 rounded-[4px] transition-colors"
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
        <div className="flex items-center justify-between px-0 py-3.5 mt-6 border-t border-[#e8e4d9]">
          <p className="text-[#888] text-[13px]">Page {page + 1} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="h-8 px-3 text-[13px] text-[#1a2744] border border-[#d0cdc5] rounded-[6px] hover:border-[#1a2744]/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            {totalPages > 1 && (
              <span className="text-[12px] text-[#888] bg-[#f0ede6] rounded-full px-2.5 py-0.5">{page + 1} / {totalPages}</span>
            )}
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="h-8 px-3 text-[13px] text-[#1a2744] border border-[#d0cdc5] rounded-[6px] hover:border-[#1a2744]/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
