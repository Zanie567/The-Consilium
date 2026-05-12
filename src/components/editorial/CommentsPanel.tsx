'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { MessageSquare, CheckCircle2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'

export interface ArticleComment {
  id: string
  articleId: string
  authorId: string
  authorName: string
  commentText: string
  resolved: boolean
  createdAt: string
  parentId: string | null
  tiptapFrom: number | null
  tiptapTo: number | null
}

interface Props {
  articleId: string
  comments: ArticleComment[]
  onCommentResolved: (commentId: string, resolved: boolean) => void
  onCommentAdded: (comment: ArticleComment) => void
  activeCommentId: string | null
  onSelectComment: (commentId: string | null) => void
}

export function CommentsPanel({
  articleId,
  comments,
  onCommentResolved,
  onCommentAdded,
  activeCommentId,
  onSelectComment,
}: Props) {
  const [showResolved, setShowResolved] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const topLevel = comments.filter((c) => c.parentId === null)
  const visible = showResolved ? topLevel : topLevel.filter((c) => !c.resolved)
  const resolvedCount = topLevel.filter((c) => c.resolved).length

  const submitReply = async (parentId: string) => {
    if (!replyText.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentText: replyText, parentId }),
      })
      if (res.ok) {
        const data = await res.json() as ArticleComment
        onCommentAdded(data)
        setReplyText('')
        setReplyingTo(null)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const resolveComment = async (commentId: string, resolved: boolean) => {
    const res = await fetch(`/api/articles/${articleId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved }),
    })
    if (res.ok) {
      onCommentResolved(commentId, resolved)
    }
  }

  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MessageSquare size={28} className="text-[var(--fg-faint)] mb-3" />
        <p className="text-sm text-[var(--fg-faint)]">No comments yet</p>
        <p className="text-xs text-[var(--fg-faint)] mt-1">
          Select text in the article to add a comment
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-subtle)]">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--fg-faint)]">
          Comments ({topLevel.filter((c) => !c.resolved).length})
        </span>
        {resolvedCount > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-[var(--fg-faint)] hover:text-gold transition-colors"
          >
            {showResolved ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showResolved ? 'Hide' : `Show ${resolvedCount} resolved`}
          </button>
        )}
      </div>

      {/* Comment list */}
      <div className="overflow-y-auto flex-1 divide-y divide-[var(--border)]">
        {visible.map((comment) => {
          const replies = comments.filter((c) => c.parentId === comment.id)
          const isActive = activeCommentId === comment.id

          return (
            <div
              key={comment.id}
              className={`p-4 transition-colors ${isActive ? 'bg-gold/5 border-l-2 border-gold' : 'hover:bg-[var(--bg-subtle)] border-l-2 border-transparent'}`}
              onClick={() => onSelectComment(isActive ? null : comment.id)}
            >
              {/* Author + timestamp */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold text-[var(--fg)]">
                  {comment.authorName}
                </span>
                <span className="text-[10px] text-[var(--fg-faint)] shrink-0">
                  {format(new Date(comment.createdAt), 'd MMM, HH:mm')}
                </span>
              </div>

              {/* Comment text */}
              <p className={`text-sm text-[var(--fg-muted)] leading-relaxed ${comment.resolved ? 'line-through opacity-60' : ''}`}>
                {comment.commentText}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-3 mt-2.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setReplyingTo(replyingTo === comment.id ? null : comment.id); setReplyText('') }}
                  className="text-[10px] text-[var(--fg-faint)] hover:text-gold transition-colors font-medium"
                >
                  Reply
                </button>
                {!comment.resolved ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); void resolveComment(comment.id, true) }}
                    className="flex items-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-500 transition-colors font-medium"
                  >
                    <CheckCircle2 size={11} />
                    Resolve
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); void resolveComment(comment.id, false) }}
                    className="flex items-center gap-1 text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors"
                  >
                    <RotateCcw size={11} />
                    Reopen
                  </button>
                )}
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <div className="mt-3 pl-3 border-l border-[var(--border)] space-y-2">
                  {replies.map((reply) => (
                    <div key={reply.id}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] font-semibold text-[var(--fg)]">
                          {reply.authorName}
                        </span>
                        <span className="text-[10px] text-[var(--fg-faint)] shrink-0">
                          {format(new Date(reply.createdAt), 'HH:mm')}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--fg-muted)] mt-0.5">{reply.commentText}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              {replyingTo === comment.id && (
                <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submitReply(comment.id)}
                    placeholder="Reply..."
                    className="flex-1 h-8 text-[13px] border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] rounded px-2.5 focus:outline-none focus:border-gold placeholder:text-[var(--fg-faint)]"
                    autoFocus
                  />
                  <button
                    onClick={() => void submitReply(comment.id)}
                    disabled={!replyText.trim() || submitting}
                    className="px-3 h-8 bg-navy text-gold text-[11px] font-bold uppercase tracking-widest rounded hover:bg-navy-dark transition-colors disabled:opacity-50"
                  >
                    Post
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
