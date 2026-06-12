/**
 * Unit tests for the inline-comment re-anchoring logic. Documents the
 * strategy: stored positions are trusted only when they still contain the
 * stored quote; otherwise the quote is searched for in the document. A unique
 * match re-anchors the highlight; zero matches or multiple matches degrade to
 * an orphaned comment (no highlight, never a guess). Out-of-range positions
 * must never throw.
 */
import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import {
  buildTextIndex,
  extractQuote,
  resolveCommentAnchor,
} from '@/lib/editor/commentAnchors'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    horizontalRule: { group: 'block' },
    text: { group: 'inline' },
  },
})

const p = (text?: string) =>
  text ? schema.node('paragraph', null, [schema.text(text)]) : schema.node('paragraph')
const doc = (...blocks: PMNode[]) => schema.node('doc', null, blocks)

describe('buildTextIndex', () => {
  it('flattens paragraphs with \\n separators and maps positions', () => {
    const d = doc(p('Hello'), p('World'))
    const { text, posMap } = buildTextIndex(d)
    expect(text).toBe('Hello\nWorld')
    // "Hello" starts at pos 1 (inside the first paragraph).
    expect(posMap[0]).toBe(1)
    // "World" starts at pos 8 (5 text + closing tag at 6, opening at 7).
    expect(posMap[6]).toBe(8)
  })

  it('skips empty paragraphs without emitting separators', () => {
    const d = doc(p('One'), p(), p('Two'))
    expect(buildTextIndex(d).text).toBe('One\nTwo')
  })
})

describe('extractQuote', () => {
  it('extracts the selected text for a valid range', () => {
    const d = doc(p('The quick brown fox'))
    expect(extractQuote(d, 5, 10)).toBe('quick')
  })

  it('extracts across paragraph boundaries with a \\n separator', () => {
    const d = doc(p('First paragraph'), p('Second paragraph'))
    // Selection from "paragraph" in p1 through "Second" in p2.
    expect(extractQuote(d, 7, 24)).toBe('paragraph\nSecond')
  })

  it('clamps out-of-range positions instead of throwing', () => {
    const d = doc(p('Short'))
    expect(() => extractQuote(d, 0, 9999)).not.toThrow()
    expect(extractQuote(d, 0, 9999)).toBe('Short')
    expect(extractQuote(d, 9999, 10000)).toBe('')
    expect(extractQuote(d, 5, 2)).toBe('')
  })
})

describe('resolveCommentAnchor', () => {
  it('returns exact when the quote is still at the stored position', () => {
    const d = doc(p('The quick brown fox'))
    const res = resolveCommentAnchor(d, { from: 5, to: 10, quotedText: 'quick' })
    expect(res).toEqual({ status: 'exact', from: 5, to: 10 })
  })

  it('re-anchors when the quote moved earlier in the document', () => {
    // Quote was at pos 5..10 when text preceded it; that text was deleted.
    const d = doc(p('quick brown fox'))
    const res = resolveCommentAnchor(d, { from: 5, to: 10, quotedText: 'quick' })
    expect(res).toEqual({ status: 'moved', from: 1, to: 6 })
  })

  it('re-anchors when the quote moved later in the document', () => {
    // Text was inserted before the quote, pushing it right.
    const d = doc(p('Some newly added words. The quick brown fox'))
    const res = resolveCommentAnchor(d, { from: 5, to: 10, quotedText: 'quick' })
    expect(res).toEqual({ status: 'moved', from: 29, to: 34 })
    // Sanity check: the re-anchored range really contains the quote.
    expect(extractQuote(d, 29, 34)).toBe('quick')
  })

  it('orphans when the quoted text was edited', () => {
    const d = doc(p('The quikc brown fox'))
    const res = resolveCommentAnchor(d, { from: 5, to: 10, quotedText: 'quick' })
    expect(res).toEqual({ status: 'orphaned', reason: 'deleted' })
  })

  it('orphans when the quoted text was deleted entirely', () => {
    const d = doc(p('The brown fox'))
    const res = resolveCommentAnchor(d, { from: 5, to: 10, quotedText: 'quick' })
    expect(res).toEqual({ status: 'orphaned', reason: 'deleted' })
  })

  it('orphans as ambiguous when the quote now appears more than once', () => {
    // Documented strategy: with several occurrences we cannot know which one
    // the comment meant, so we refuse to guess rather than highlight the
    // wrong text silently.
    const d = doc(p('quick things and quick fixes'))
    const res = resolveCommentAnchor(d, { from: 50, to: 55, quotedText: 'quick' })
    expect(res).toEqual({ status: 'orphaned', reason: 'ambiguous' })
  })

  it('keeps exact stored positions even when the quote is duplicated elsewhere', () => {
    const d = doc(p('quick things and quick fixes'))
    const res = resolveCommentAnchor(d, { from: 1, to: 6, quotedText: 'quick' })
    expect(res).toEqual({ status: 'exact', from: 1, to: 6 })
  })

  it('handles a comment spanning multiple paragraphs', () => {
    const d = doc(p('First paragraph'), p('Second paragraph'))
    const quote = 'paragraph\nSecond'
    // Exact at the original positions.
    expect(resolveCommentAnchor(d, { from: 7, to: 24, quotedText: quote }))
      .toEqual({ status: 'exact', from: 7, to: 24 })
    // Moved after content was prepended.
    const d2 = doc(p('A new intro'), p('First paragraph'), p('Second paragraph'))
    const res = resolveCommentAnchor(d2, { from: 7, to: 24, quotedText: quote })
    expect(res.status).toBe('moved')
    if (res.status === 'moved') {
      expect(extractQuote(d2, res.from, res.to)).toBe(quote)
    }
  })

  it('never throws for positions beyond the document length after a big deletion', () => {
    const d = doc(p('Tiny'))
    expect(() =>
      resolveCommentAnchor(d, { from: 500, to: 600, quotedText: 'gone forever' })
    ).not.toThrow()
    expect(resolveCommentAnchor(d, { from: 500, to: 600, quotedText: 'gone forever' }))
      .toEqual({ status: 'orphaned', reason: 'deleted' })
    // And if the quote still exists, huge stale positions still re-anchor.
    expect(resolveCommentAnchor(d, { from: 500, to: 600, quotedText: 'Tiny' }))
      .toEqual({ status: 'moved', from: 1, to: 5 })
  })

  it('treats anchorless comments (replies) as unanchored', () => {
    const d = doc(p('Whatever'))
    expect(resolveCommentAnchor(d, { from: null, to: null, quotedText: null }))
      .toEqual({ status: 'unanchored' })
  })

  it('orphans legacy comments that stored positions but no quote', () => {
    const d = doc(p('Some text here'))
    expect(resolveCommentAnchor(d, { from: 1, to: 5, quotedText: null }))
      .toEqual({ status: 'orphaned', reason: 'unverifiable' })
  })

  it('ignores blockquote nesting when flattening', () => {
    const d = doc(
      p('Lead in'),
      schema.node('blockquote', null, [p('Quoted wisdom')]),
      p('After')
    )
    const { text } = buildTextIndex(d)
    expect(text).toBe('Lead in\nQuoted wisdom\nAfter')
  })
})
