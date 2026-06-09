'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { formatDistanceToNow, format, isAfter, subDays } from 'date-fns'
import { ThumbsUp, Reply, Trash2, Flag, ChevronDown } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface CommentUser {
  id: string
  name: string | null
  image: string | null
}

interface CommentItem {
  id: string
  body: string
  createdAt: string
  upvotes: number
  parentId: string | null
  user: CommentUser
  replies?: CommentItem[]
  upvotedBy?: { id: string }[]
  _count?: { replies: number }
}

interface SessionUser {
  id: string
  name?: string | null
  role?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const sevenDaysAgo = subDays(new Date(), 7)
  if (isAfter(date, sevenDaysAgo)) {
    return formatDistanceToNow(date, { addSuffix: true })
  }
  return format(date, 'd MMM yyyy')
}

function initials(name: string | null | undefined): string {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return name.slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ user }: { user: CommentUser }) {
  return (
    <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center shrink-0">
      <span className="text-gold text-[10px] font-bold">{initials(user.name)}</span>
    </div>
  )
}

// ── Composer ─────────────────────────────────────────────────────────────────

interface ComposerProps {
  articleId: string
  parentId?: string
  onSuccess: (comment: CommentItem) => void
  onCancel?: () => void
  autoFocus?: boolean
}

function Composer({ articleId, parentId, onSuccess, onCancel, autoFocus }: ComposerProps) {
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (body.trim().length < 3) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, body, parentId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to post comment.')
        return
      }
      setBody('')
      onSuccess(json)
    } catch {
      setError('Failed to post comment. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={parentId ? 'Write a reply…' : 'Join the discussion…'}
        maxLength={1000}
        rows={3}
        className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--fg)] text-sm p-3 resize-none focus:outline-none focus:border-gold transition-colors"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[var(--fg-faint)] text-[10px]">{body.length}/1000</span>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-[var(--fg-faint)] text-xs px-3 py-1.5 hover:text-[var(--fg)] transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading || body.trim().length < 3}
            className="bg-navy text-cream text-xs font-bold uppercase tracking-widest px-4 py-1.5 hover:bg-navy/90 disabled:opacity-50 transition-colors"
          >
            {loading ? '…' : 'Post'}
          </button>
        </div>
      </div>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </form>
  )
}

// ── Single comment ────────────────────────────────────────────────────────────

interface SingleCommentProps {
  comment: CommentItem
  currentUser: SessionUser | null
  articleId: string
  onDelete: (id: string) => void
  onReplyPosted: (parentId: string, reply: CommentItem) => void
  isReply?: boolean
}

function SingleComment({
  comment,
  currentUser,
  articleId,
  onDelete,
  onReplyPosted,
  isReply,
}: SingleCommentProps) {
  const [upvotes, setUpvotes] = useState(comment.upvotes)
  const [upvoted, setUpvoted] = useState((comment.upvotedBy?.length ?? 0) > 0)
  const [showReply, setShowReply] = useState(false)
  const [reported, setReported] = useState(false)
  const [showReplies, setShowReplies] = useState(false)

  async function toggleUpvote() {
    if (!currentUser) return
    try {
      const res = await fetch(`/api/comments/${comment.id}/upvote`, { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        setUpvotes(json.upvotes)
        setUpvoted(json.upvoted)
      }
    } catch {
      // Network error - upvote state unchanged
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' })
      if (res.ok) onDelete(comment.id)
    } catch {
      // Network error - comment not deleted
    }
  }

  async function handleReport() {
    try {
      const res = await fetch(`/api/comments/${comment.id}/report`, { method: 'POST' })
      if (res.ok) setReported(true)
    } catch {
      // Network error - report not submitted
    }
  }

  const isOwner = currentUser?.id === comment.user.id
  const isAdmin = currentUser?.role === 'ADMIN'
  const replyCount = comment._count?.replies ?? comment.replies?.length ?? 0

  return (
    <div className={`flex gap-3 ${isReply ? 'ml-8 mt-3' : ''}`}>
      <Avatar user={comment.user} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-[var(--fg)]">{comment.user.name ?? 'Anonymous'}</span>
          <span className="text-[var(--fg-faint)] text-[10px]">{timeLabel(comment.createdAt)}</span>
        </div>
        <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{comment.body}</p>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={toggleUpvote}
            disabled={!currentUser}
            className={`flex items-center gap-1 text-[10px] font-semibold transition-colors ${
              upvoted ? 'text-gold' : 'text-[var(--fg-faint)] hover:text-gold'
            }`}
          >
            <ThumbsUp size={11} />
            {upvotes > 0 && upvotes}
          </button>

          {!isReply && currentUser && (
            <button
              onClick={() => {
                setShowReply((v) => !v)
              }}
              className="flex items-center gap-1 text-[10px] font-semibold text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors"
            >
              <Reply size={11} />
              Reply
            </button>
          )}

          {(isOwner || isAdmin) && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 text-[10px] font-semibold text-[var(--fg-faint)] hover:text-red-500 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          )}

          {currentUser && !isOwner && (
            <button
              onClick={handleReport}
              disabled={reported}
              className={`flex items-center gap-1 text-[10px] font-semibold transition-colors ${
                reported ? 'text-gold' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]'
              }`}
            >
              <Flag size={11} />
              {reported ? 'Reported' : ''}
            </button>
          )}
        </div>

        {/* Reply composer */}
        {showReply && (
          <div className="mt-3">
            <Composer
              articleId={articleId}
              parentId={comment.id}
              autoFocus
              onSuccess={(reply) => {
                onReplyPosted(comment.id, reply)
                setShowReply(false)
                setShowReplies(true)
              }}
              onCancel={() => setShowReply(false)}
            />
          </div>
        )}

        {/* Replies */}
        {replyCount > 0 && !isReply && (
          <div>
            {!showReplies ? (
              <button
                onClick={() => setShowReplies(true)}
                className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-[var(--fg-faint)] hover:text-gold transition-colors"
              >
                <ChevronDown size={11} />
                Show {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </button>
            ) : (
              <div className="mt-2 border-l border-[var(--border)] pl-3">
                {(comment.replies ?? []).map((reply) => (
                  <SingleComment
                    key={reply.id}
                    comment={reply}
                    currentUser={currentUser}
                    articleId={articleId}
                    onDelete={onDelete}
                    onReplyPosted={onReplyPosted}
                    isReply
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

interface Props {
  articleId: string
  currentUser: SessionUser | null
}

export function CommentSection({ articleId, currentUser }: Props) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchComments = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/comments?articleId=${articleId}`)
      if (!res.ok) {
        // A failed fetch (e.g. a 503 from the pooler) must surface as an error
        // state — not silently fall through to "No comments yet" or hang on the
        // skeleton forever.
        setError(true)
        return
      }
      const json = await res.json()
      setComments(Array.isArray(json.comments) ? json.comments : [])
      setTotal(json.total ?? 0)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [articleId])

  useEffect(() => { fetchComments() }, [fetchComments])

  function handleNewComment(comment: CommentItem) {
    setComments((prev) => [comment, ...prev])
    setTotal((t) => t + 1)
  }

  function handleDelete(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id))
    setTotal((t) => Math.max(0, t - 1))
  }

  function handleReplyPosted(parentId: string, reply: CommentItem) {
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== parentId) return c
        return {
          ...c,
          replies: [...(c.replies ?? []), reply],
          _count: { replies: (c._count?.replies ?? 0) + 1 },
        }
      }),
    )
    setTotal((t) => t + 1)
  }

  return (
    <div className="mt-14 pt-10 border-t border-[var(--border)]">
      <h2
        className="text-lg font-bold text-[var(--fg)] mb-6"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Discussion
        {total > 0 && (
          <span className="ml-2 text-[var(--fg-faint)] text-sm font-normal">({total})</span>
        )}
      </h2>

      {/* Composer - logged-in only */}
      {currentUser ? (
        <div className="mb-8">
          <Composer articleId={articleId} onSuccess={handleNewComment} />
        </div>
      ) : (
        <div className="mb-8 p-4 bg-[var(--bg-subtle)] border border-[var(--border)] text-center">
          <p className="text-[var(--fg-muted)] text-sm">
            <a href="/login" className="text-gold hover:underline font-semibold">Sign in</a>
            {' '}to join the discussion.
          </p>
        </div>
      )}

      {/* Comment list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-[var(--border)] animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-[var(--border)] animate-pulse" />
                <div className="h-3 w-full bg-[var(--border)] animate-pulse" />
                <div className="h-3 w-3/4 bg-[var(--border)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-[var(--fg-muted)] text-sm mb-3">
            Couldn&apos;t load the discussion. Please try again.
          </p>
          <button
            onClick={fetchComments}
            className="text-gold text-xs font-bold uppercase tracking-widest border border-gold/50 px-4 py-2 hover:bg-gold hover:text-navy transition-colors"
          >
            Retry
          </button>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[var(--fg-faint)] text-sm text-center py-8">
          No comments yet. Be the first to share your thoughts.
        </p>
      ) : (
        <div className="space-y-6">
          {comments.map((c) => (
            <SingleComment
              key={c.id}
              comment={c}
              currentUser={currentUser}
              articleId={articleId}
              onDelete={handleDelete}
              onReplyPosted={handleReplyPosted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
