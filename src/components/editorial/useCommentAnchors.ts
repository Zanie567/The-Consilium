'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { resolveCommentAnchor, type ResolvedAnchor } from '@/lib/editor/commentAnchors'
import {
  setCommentHighlights,
  setActiveCommentHighlight,
  type CommentHighlightRange,
} from '@/components/editor/commentHighlight'
import type { ArticleComment } from '@/components/editorial/CommentsPanel'

export type CommentAnchorMap = Record<string, ResolvedAnchor>

/**
 * Resolves every top-level comment's stored anchor against the current
 * document (verifying the stored quote, re-anchoring moved quotes, orphaning
 * deleted or ambiguous ones) and keeps the editor's highlight decorations in
 * sync. Returns the per-comment anchor status so panels can flag orphans.
 */
export function useCommentAnchors(
  editor: Editor | null,
  comments: ArticleComment[],
  activeCommentId: string | null
): CommentAnchorMap {
  const [anchors, setAnchors] = useState<CommentAnchorMap>({})

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const map: CommentAnchorMap = {}
    const ranges: CommentHighlightRange[] = []
    for (const comment of comments) {
      if (comment.parentId) continue
      const resolved = resolveCommentAnchor(editor.state.doc, {
        from: comment.tiptapFrom,
        to: comment.tiptapTo,
        quotedText: comment.quotedText ?? null,
      })
      map[comment.id] = resolved
      if (resolved.status === 'exact' || resolved.status === 'moved') {
        ranges.push({
          id: comment.id,
          from: resolved.from,
          to: resolved.to,
          resolved: comment.resolved,
        })
      }
    }
    setAnchors(map)
    setCommentHighlights(editor, ranges)
  }, [editor, comments])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    setActiveCommentHighlight(editor, activeCommentId)
  }, [editor, activeCommentId])

  return anchors
}
