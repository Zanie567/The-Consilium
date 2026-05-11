'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { MessageSquare } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { ArticleComment } from '@/components/editorial/CommentsPanel'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[300px] animate-pulse bg-[var(--bg-subtle)]" /> }
) as React.ComponentType<{
  content?: string
  onChange: (v: string) => void
  editable?: boolean
  onEditorReady?: (editor: Editor) => void
}>

interface Props {
  content: string
  articleId: string
  comments: ArticleComment[]
  activeCommentId: string | null
  onCommentCreated: (comment: ArticleComment) => void
  onSelectComment: (id: string | null) => void
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

export function ArticlePreviewWithComments({
  content,
  articleId,
  comments,
  activeCommentId,
  onCommentCreated,
  onSelectComment,
}: Props) {
  const editorRef = useRef<Editor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const portalBtnRef = useRef<HTMLButtonElement>(null)
  const portalFormRef = useRef<HTMLDivElement>(null)
  const [floatingBtn, setFloatingBtn] = useState<FloatingButtonState>({ visible: false, vx: 0, vy: 0, from: 0, to: 0 })
  const [commentFormOpen, setCommentFormOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Apply comment highlights when editor is ready or comments change
  const applyHighlights = useCallback((editor: Editor) => {
    if (!editor.isEditable) {
      comments.forEach((c) => {
        if (c.tiptapFrom !== null && c.tiptapTo !== null) {
          editor.chain().setTextSelection({ from: c.tiptapFrom, to: c.tiptapTo })
            .setMark('commentMark', { commentId: c.id, resolved: c.resolved })
            .run()
        }
      })
    }
  }, [comments])

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor
    applyHighlights(editor)
  }, [applyHighlights])

  // Show floating comment button on text selection
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseUp = () => {
      const editor = editorRef.current
      if (!editor) return

      const { from, to } = editor.state.selection
      if (from === to) {
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
      const inContainer = containerRef.current?.contains(target)
      const inPortalBtn = portalBtnRef.current?.contains(target)
      const inPortalForm = portalFormRef.current?.contains(target)
      if (!inContainer && !inPortalBtn && !inPortalForm) {
        setFloatingBtn((s) => ({ ...s, visible: false }))
        setCommentFormOpen(false)
      }
    }

    container.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      container.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [])

  // Scroll active comment's highlight into view
  useEffect(() => {
    if (!activeCommentId) return
    const el = containerRef.current?.querySelector(`[data-comment-id="${activeCommentId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeCommentId])

  const submitComment = async () => {
    if (!commentText.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentText,
          tiptapFrom: floatingBtn.from,
          tiptapTo: floatingBtn.to,
        }),
      })
      if (res.ok) {
        const newComment = await res.json() as ArticleComment

        // Apply the highlight mark to the editor
        const editor = editorRef.current
        if (editor) {
          editor.chain()
            .setTextSelection({ from: floatingBtn.from, to: floatingBtn.to })
            .setMark('commentMark', { commentId: newComment.id, resolved: false })
            .run()
        }

        onCommentCreated(newComment)
        setCommentText('')
        setCommentFormOpen(false)
        setFloatingBtn((s) => ({ ...s, visible: false }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const portalContent = typeof document !== 'undefined' ? (
    <>
      {/* Floating "add comment" button - rendered via portal to escape overflow:hidden parents */}
      {floatingBtn.visible && !commentFormOpen && (
        <button
          ref={portalBtnRef}
          type="button"
          onClick={() => { setCommentFormOpen(true); setCommentText('') }}
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

      {/* Comment form popover - rendered via portal to escape overflow:hidden parents */}
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
    </>
  ) : null

  return (
    <div ref={containerRef} className="relative">
      {/* TipTap read-only preview */}
      <TiptapEditor
        content={content}
        onChange={() => {}}
        editable={false}
        onEditorReady={handleEditorReady}
      />

      {portalContent && createPortal(portalContent, document.body)}
    </div>
  )
}
