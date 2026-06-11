'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { extractQuote } from '@/lib/editor/commentAnchors'
import type { ArticleComment } from '@/components/editorial/CommentsPanel'

interface Props {
  editor: Editor | null
  articleId: string
  onCommentCreated: (comment: ArticleComment) => void
}

interface FloatingButtonState {
  visible: boolean
  /** Viewport-relative left position for the portal-rendered UI */
  vx: number
  /** Viewport-relative top position for the portal-rendered UI */
  vy: number
  from: number
  to: number
}

/**
 * Floating "Comment" button plus comment form that appears over a text
 * selection inside a Tiptap editor. Works on both the read-only review
 * preview and the writer's live editor. Captures the exact quoted text of the
 * selection at submit time so the comment can be re-anchored after edits.
 */
export function CommentSelectionPopover({ editor, articleId, onCommentCreated }: Props) {
  const portalBtnRef = useRef<HTMLButtonElement>(null)
  const portalFormRef = useRef<HTMLDivElement>(null)
  const [floatingBtn, setFloatingBtn] = useState<FloatingButtonState>({ visible: false, vx: 0, vy: 0, from: 0, to: 0 })
  const [commentFormOpen, setCommentFormOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Show the floating comment button when a text selection is made
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view.dom

    const handleMouseUp = () => {
      if (editor.isDestroyed) return
      const { from, to } = editor.state.selection
      if (from === to || !extractQuote(editor.state.doc, from, to)) {
        setFloatingBtn((s) => ({ ...s, visible: false }))
        return
      }

      // Get the DOM selection to position the button
      const domSel = window.getSelection()
      if (!domSel || domSel.rangeCount === 0) return

      const range = domSel.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      setFloatingBtn({
        visible: true,
        vx: rect.left + rect.width / 2,
        vy: rect.top - 8,
        from,
        to,
      })
    }

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      const inEditor = dom.contains(target)
      const inPortalBtn = portalBtnRef.current?.contains(target)
      const inPortalForm = portalFormRef.current?.contains(target)
      if (!inEditor && !inPortalBtn && !inPortalForm) {
        setFloatingBtn((s) => ({ ...s, visible: false }))
        setCommentFormOpen(false)
      }
    }

    dom.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      dom.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [editor])

  const submitComment = async () => {
    if (!commentText.trim() || submitting || !editor || editor.isDestroyed) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const quotedText = extractQuote(editor.state.doc, floatingBtn.from, floatingBtn.to)
      const res = await fetch(`/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentText,
          tiptapFrom: floatingBtn.from,
          tiptapTo: floatingBtn.to,
          quotedText,
        }),
      })
      if (res.ok) {
        const newComment = await res.json() as ArticleComment
        onCommentCreated(newComment)
        setCommentText('')
        setCommentFormOpen(false)
        setFloatingBtn((s) => ({ ...s, visible: false }))
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string }
        setSubmitError(json.error ?? 'Could not save the comment. Please try again.')
      }
    } catch {
      setSubmitError('Network problem. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Floating "add comment" button - portal-rendered to escape overflow:hidden parents */}
      {floatingBtn.visible && !commentFormOpen && (
        <button
          ref={portalBtnRef}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setCommentFormOpen(true); setCommentText(''); setSubmitError(null) }}
          className="fixed z-[200] flex items-center gap-1.5 bg-gold text-navy text-xs font-bold px-2.5 py-1.5 rounded-full shadow-lg hover:bg-gold/90 transition-colors"
          style={{
            left: floatingBtn.vx,
            top: floatingBtn.vy,
            transform: 'translate(-50%, -100%)',
          }}
          aria-label="Add comment"
        >
          <MessageSquare size={13} />
          Comment
        </button>
      )}

      {/* Comment form popover - portal-rendered to escape overflow:hidden parents */}
      {commentFormOpen && (
        <div
          ref={portalFormRef}
          className="fixed z-[200] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl shadow-2xl p-3 w-72"
          style={{
            left: Math.min(floatingBtn.vx, window.innerWidth - 296),
            top: floatingBtn.vy,
            transform: 'translateY(-100%) translateY(-8px)',
          }}
        >
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitComment() }}
            placeholder="Add a comment..."
            rows={3}
            autoFocus
            className="w-full bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-gold resize-none placeholder:text-[var(--fg-faint)]"
          />
          {submitError && (
            <p className="text-[11px] text-red-500 mt-2">{submitError}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-[var(--fg-faint)]">Cmd+Enter to submit</span>
            <div className="flex gap-2">
              <button
                onClick={() => { setCommentFormOpen(false); setFloatingBtn((s) => ({ ...s, visible: false })) }}
                className="text-xs text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitComment()}
                disabled={!commentText.trim() || submitting}
                className="text-xs font-bold bg-navy text-gold px-3 py-1 rounded hover:bg-navy-dark transition-colors disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Add comment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
