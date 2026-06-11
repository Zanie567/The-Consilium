/**
 * Re-anchoring logic for inline review comments.
 *
 * A comment stores the ProseMirror positions (tiptapFrom/tiptapTo) of the text
 * selection it was attached to, plus the exact quoted text of that selection.
 * Positions go stale the moment the draft is edited, so before rendering a
 * highlight we verify the stored range still contains the quote. If it does
 * not, we search the whole document for the quote and re-anchor; if the quote
 * has been deleted or now appears more than once (so the right occurrence is
 * ambiguous), the comment degrades to an "orphaned" state: it stays visible in
 * the panel with its quoted text, but no highlight is drawn. We never guess,
 * and we never throw on out-of-range positions.
 *
 * All functions here are pure and operate on a ProseMirror Node, so they can
 * be unit-tested without a browser or a Tiptap editor instance.
 */
import type { Node as PMNode } from '@tiptap/pm/model'

/** Separator emitted between textblocks when flattening the doc to a string. */
const BLOCK_SEPARATOR = '\n'

export interface CommentAnchor {
  from: number | null
  to: number | null
  quotedText: string | null
}

export type ResolvedAnchor =
  /** The stored positions still contain the quote; highlight them as-is. */
  | { status: 'exact'; from: number; to: number }
  /** The quote moved; it was found at exactly one new location. */
  | { status: 'moved'; from: number; to: number }
  /** No safe highlight: the quote was deleted, duplicated, or never stored. */
  | { status: 'orphaned'; reason: 'deleted' | 'ambiguous' | 'unverifiable' }
  /** The comment was never anchored to a selection (e.g. a reply). */
  | { status: 'unanchored' }

interface TextIndex {
  /** The document flattened to plain text, textblocks joined by '\n'. */
  text: string
  /** posMap[i] = ProseMirror position of text[i]. */
  posMap: number[]
}

/**
 * Flattens a document into plain text with a position map. Block boundaries
 * become a single '\n' (mapped to the position just before the textblock), so
 * quotes that span paragraphs can be matched and re-anchored too.
 */
export function buildTextIndex(doc: PMNode): TextIndex {
  let text = ''
  const posMap: number[] = []
  let lastTextblockPos = -1

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        text += node.text[i]
        posMap.push(pos + i)
      }
      return true
    }
    if (node.isTextblock) {
      // Empty textblocks contribute nothing, mirroring how the text reads.
      if (node.content.size > 0 && text.length > 0 && lastTextblockPos !== pos) {
        text += BLOCK_SEPARATOR
        posMap.push(pos)
      }
      lastTextblockPos = pos
      return true
    }
    return true
  })

  return { text, posMap }
}

/**
 * Extracts the canonical quoted text for a position range. This is what gets
 * stored as quotedText at comment creation, and what stored quotes are
 * compared against later, so both sides always use the same text model.
 * Out-of-range positions are clamped; never throws.
 */
export function extractQuote(doc: PMNode, from: number, to: number): string {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return ''
  const { text, posMap } = buildTextIndex(doc)
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    if (posMap[i] >= from && posMap[i] < to) quote += text[i]
  }
  // A range that starts or ends on a block boundary can pick up a dangling
  // separator; quotes never meaningfully start or end with one.
  return quote.replace(/^\n+|\n+$/g, '')
}

function findOccurrences(haystack: string, needle: string): number[] {
  const found: number[] = []
  if (!needle) return found
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    found.push(idx)
    idx = haystack.indexOf(needle, idx + 1)
  }
  return found
}

/**
 * Resolves where (and whether) a stored comment anchor should be highlighted
 * in the current document. See module docblock for the strategy. Never throws,
 * even for positions far beyond the document length.
 */
export function resolveCommentAnchor(doc: PMNode, anchor: CommentAnchor): ResolvedAnchor {
  const { from, to, quotedText } = anchor

  const hasPositions =
    typeof from === 'number' && typeof to === 'number' &&
    Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from

  if (!hasPositions && !quotedText) return { status: 'unanchored' }

  // Without a stored quote there is nothing to verify the positions against.
  // Highlighting unverified positions risks silently marking the wrong text,
  // so legacy rows without a quote orphan instead.
  if (!quotedText) return { status: 'orphaned', reason: 'unverifiable' }

  const index = buildTextIndex(doc)

  // 1. Check whether the stored range still contains exactly the quote.
  if (hasPositions && to <= doc.content.size) {
    let stored = ''
    for (let i = 0; i < index.text.length; i++) {
      if (index.posMap[i] >= (from as number) && index.posMap[i] < (to as number)) {
        stored += index.text[i]
      }
    }
    if (stored.replace(/^\n+|\n+$/g, '') === quotedText) {
      return { status: 'exact', from: from as number, to: to as number }
    }
  }

  // 2. Stale positions: search the document for the quote.
  const occurrences = findOccurrences(index.text, quotedText)
  if (occurrences.length === 0) return { status: 'orphaned', reason: 'deleted' }
  if (occurrences.length > 1) return { status: 'orphaned', reason: 'ambiguous' }

  const start = occurrences[0]
  const end = start + quotedText.length - 1
  return {
    status: 'moved',
    from: index.posMap[start],
    to: index.posMap[end] + 1,
  }
}
