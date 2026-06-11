'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Editor } from '@tiptap/react'
import type { ArticleComment } from '@/components/editorial/CommentsPanel'
import { CommentSelectionPopover } from '@/components/editorial/CommentSelectionPopover'
import { useCommentAnchors, type CommentAnchorMap } from '@/components/editorial/useCommentAnchors'
import { scrollToCommentHighlight } from '@/components/editor/commentHighlight'

const TiptapEditor = dynamic(
  () => import('@/components/editor/TiptapEditor').then((m) => m.TiptapEditor),
  { ssr: false, loading: () => <div className="min-h-[300px] animate-pulse bg-[var(--bg-subtle)]" /> }
) as React.ComponentType<{
  content?: string
  onChange: (v: string) => void
  editable?: boolean
  onEditorReady?: (editor: Editor) => void
  onCommentClick?: (commentId: string) => void
}>

interface Props {
  content: string
  articleId: string
  comments: ArticleComment[]
  activeCommentId: string | null
  onCommentCreated: (comment: ArticleComment) => void
  onSelectComment: (id: string | null) => void
  /** Reports each comment's anchor state so the panel can flag orphans. */
  onAnchorsChange?: (anchors: CommentAnchorMap) => void
}

export function ArticlePreviewWithComments({
  content,
  articleId,
  comments,
  activeCommentId,
  onCommentCreated,
  onSelectComment,
  onAnchorsChange,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null)

  // Verify stored anchors against the document, re-anchor moved quotes, and
  // keep the highlight decorations in sync.
  const anchors = useCommentAnchors(editor, comments, activeCommentId)

  useEffect(() => {
    onAnchorsChange?.(anchors)
  }, [anchors, onAnchorsChange])

  // Scroll the active comment's highlight into view
  useEffect(() => {
    if (!activeCommentId || !editor) return
    scrollToCommentHighlight(editor, activeCommentId)
  }, [activeCommentId, editor])

  return (
    <div className="relative">
      {/* TipTap read-only preview */}
      <TiptapEditor
        content={content}
        onChange={() => {}}
        editable={false}
        onEditorReady={setEditor}
        onCommentClick={(id) => onSelectComment(id)}
      />

      <CommentSelectionPopover
        editor={editor}
        articleId={articleId}
        onCommentCreated={onCommentCreated}
      />
    </div>
  )
}
