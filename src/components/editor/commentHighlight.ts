/**
 * Display-only highlights for inline review comments.
 *
 * Implemented as ProseMirror decorations rather than marks on purpose:
 * decorations are never part of the document, so comment highlights can never
 * leak into the saved article JSON (and from there into the public site).
 * They also map through edits automatically, so a highlight stays glued to
 * its text while the writer types around it, and silently disappears if the
 * underlying text is deleted mid-session instead of drifting onto wrong text.
 *
 * Components push resolved highlight ranges in with setCommentHighlights()
 * (after verifying them against the stored quotes, see
 * src/lib/editor/commentAnchors.ts) and receive clicks through the
 * onCommentClick option.
 */
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface CommentHighlightRange {
  id: string
  from: number
  to: number
  resolved: boolean
}

interface CommentHighlightState {
  ranges: CommentHighlightRange[]
  activeId: string | null
  decorations: DecorationSet
}

interface CommentHighlightMeta {
  ranges?: CommentHighlightRange[]
  activeId?: string | null
}

export interface CommentHighlightOptions {
  /** Called with the comment id when a highlighted range is clicked. */
  onCommentClick?: (commentId: string) => void
}

export const commentHighlightKey = new PluginKey<CommentHighlightState>('commentHighlight')

function buildDecorations(
  doc: PMNode,
  ranges: CommentHighlightRange[],
  activeId: string | null
): DecorationSet {
  const decorations: Decoration[] = []
  const max = doc.content.size
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, max))
    const to = Math.max(0, Math.min(range.to, max))
    if (from >= to) continue
    const classes = ['comment-highlight']
    if (range.resolved) classes.push('comment-highlight-resolved')
    if (range.id === activeId) classes.push('comment-highlight-active')
    decorations.push(
      Decoration.inline(from, to, {
        class: classes.join(' '),
        'data-comment-id': range.id,
      })
    )
  }
  return DecorationSet.create(doc, decorations)
}

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: 'commentHighlight',

  addOptions() {
    return { onCommentClick: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<CommentHighlightState>({
        key: commentHighlightKey,
        state: {
          init: () => ({ ranges: [], activeId: null, decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(commentHighlightKey) as CommentHighlightMeta | undefined
            if (meta) {
              const ranges = meta.ranges ?? value.ranges
              const activeId = meta.activeId !== undefined ? meta.activeId : value.activeId
              return { ranges, activeId, decorations: buildDecorations(tr.doc, ranges, activeId) }
            }
            if (!tr.docChanged) return value
            // Map highlights through the edit so they follow the text. Ranges
            // whose text was deleted collapse and get dropped, never drifting
            // onto neighbouring text.
            const ranges = value.ranges
              .map((range) => ({
                ...range,
                from: tr.mapping.map(range.from, 1),
                to: tr.mapping.map(range.to, -1),
              }))
              .filter((range) => range.from < range.to)
            return {
              ranges,
              activeId: value.activeId,
              decorations: buildDecorations(tr.doc, ranges, value.activeId),
            }
          },
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state)?.decorations ?? DecorationSet.empty
          },
          handleClick(_view, _pos, event) {
            const target = (event.target as HTMLElement | null)?.closest?.('[data-comment-id]')
            const id = target?.getAttribute('data-comment-id')
            if (id && options.onCommentClick) {
              options.onCommentClick(id)
            }
            return false
          },
        },
      }),
    ]
  },
})

/** Replaces the highlighted ranges (and optionally the active comment). */
export function setCommentHighlights(
  editor: Editor,
  ranges: CommentHighlightRange[],
  activeId?: string | null
) {
  if (editor.isDestroyed) return
  const meta: CommentHighlightMeta = { ranges }
  if (activeId !== undefined) meta.activeId = activeId
  editor.view.dispatch(editor.state.tr.setMeta(commentHighlightKey, meta))
}

/** Marks one comment's highlight as active (or clears with null). */
export function setActiveCommentHighlight(editor: Editor, activeId: string | null) {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(commentHighlightKey, { activeId }))
}

/** Scrolls the highlight for a comment into view and lets the CSS flash it. */
export function scrollToCommentHighlight(editor: Editor, commentId: string) {
  if (editor.isDestroyed) return
  const el = editor.view.dom.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
