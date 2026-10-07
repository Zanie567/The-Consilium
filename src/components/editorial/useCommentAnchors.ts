'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { resolveCommentAnchor, type ResolvedAnchor } from '@/lib/editor/commentAnchors'
import {
  setCommentHighlights,
  setActiveCommentHighlight,
  type CommentHighlightRange,
} from '@/components/editor/commentHighlight'
import type { ArticleComment } from '@/components/editorial/CommentsPanel'

export type CommentAnchorMap = Record<string, ResolvedAnchor>

function sameAnchors(a: CommentAnchorMap, b: CommentAnchorMap): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const x = a[key]
    const y = b[key]
    return y !== undefined && JSON.stringify(x) === JSON.stringify(y)
  })
}

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
  const lastAnchors = useRef<CommentAnchorMap>({})
  const pushed = useRef<{ editor: Editor | null; key: string }>({ editor: null, key: '' })

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
    // setAnchors is skipped when there is nothing to resolve and nothing was resolved
    // before: this effect re-runs on every keystroke (editor.state.doc is a dependency),
    // and a state update from it re-renders the whole editor page each time. Sustained
    // typing then tripped React's nested-update limit (error #185) from inside the
    // editor's own onUpdate handler, so an edit could be dropped before it was recorded.
    if (!sameAnchors(lastAnchors.current, map)) {
      lastAnchors.current = map
      setAnchors(map)
    }
    // Push highlights only when they differ from what the editor already has. This effect
    // runs on every keystroke, and an unconditional dispatch made each keystroke a second
    // transaction (and a second synchronous re-render); sustained typing then tripped
    // React's nested-update limit (error #185) from inside the editor's own onUpdate.
    const key = JSON.stringify(ranges)
    if (pushed.current.editor !== editor || pushed.current.key !== key) {
      pushed.current = { editor, key }
      setCommentHighlights(editor, ranges)
    }
    // editor.state.doc is in the deps so anchors re-resolve as the writer types:
    // the plugin maps highlights through edits, but only re-resolving can detect
    // a quote that was edited mid-span and orphan it instead of highlighting the
    // now-wrong text. A highlights-only dispatch leaves the doc reference
    // unchanged, so this does not loop.
  }, [editor, comments, editor?.state.doc])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    setActiveCommentHighlight(editor, activeCommentId)
  }, [editor, activeCommentId])

  return anchors
}
