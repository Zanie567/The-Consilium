/**
 * Unit tests for src/lib/readTime.ts and src/lib/reading-minutes.ts
 */

import { describe, it, expect } from 'vitest'
import { readTimeMinutes, readTimeLabel, wordCountFromContent } from '@/lib/readTime'
import { countWordsInTiptapContent, estimateReadingMinutes } from '@/lib/reading-minutes'

// ── Helpers ───────────────────────────────────────────────────────────────────

function tiptapDoc(text: string) {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  })
}

function nWords(n: number) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
}

// ── readTimeMinutes ───────────────────────────────────────────────────────────

describe('readTimeMinutes', () => {
  it('returns at least 1 for empty string', () => {
    expect(readTimeMinutes('')).toBe(1)
  })

  it('returns 1 for a single word', () => {
    expect(readTimeMinutes('hello')).toBe(1)
  })

  it('returns 1 for 200 words (exactly 1 min at 200wpm)', () => {
    expect(readTimeMinutes(nWords(200))).toBe(1)
  })

  it('returns 2 for 300 words (rounds to nearest)', () => {
    expect(readTimeMinutes(nWords(300))).toBe(2)
  })

  it('returns 5 for 1000 words', () => {
    expect(readTimeMinutes(nWords(1000))).toBe(5)
  })

  it('handles valid Tiptap JSON — extracts text before counting', () => {
    const json = tiptapDoc(nWords(400))
    expect(readTimeMinutes(json)).toBe(2)
  })

  it('falls back to plain text when JSON is malformed', () => {
    const plainText = nWords(200)
    expect(readTimeMinutes(plainText)).toBe(1)
  })

  it('handles empty Tiptap JSON doc (no text nodes) → 1 min minimum', () => {
    const emptyDoc = JSON.stringify({ type: 'doc', content: [] })
    expect(readTimeMinutes(emptyDoc)).toBe(1)
  })

  it('handles deeply nested Tiptap nodes', () => {
    const nested = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: nWords(400) }],
            },
          ],
        },
      ],
    })
    expect(readTimeMinutes(nested)).toBe(2)
  })

  it('result is always a positive integer', () => {
    for (const wc of [1, 50, 199, 200, 201, 1000, 9999]) {
      const result = readTimeMinutes(nWords(wc))
      expect(result).toBeGreaterThan(0)
      expect(Number.isInteger(result)).toBe(true)
    }
  })
})

// ── readTimeLabel ─────────────────────────────────────────────────────────────

describe('readTimeLabel', () => {
  it('returns "1 min read" for a short text', () => {
    expect(readTimeLabel('hello world')).toBe('1 min read')
  })

  it('returns "5 min read" for 1000 words', () => {
    expect(readTimeLabel(nWords(1000))).toBe('5 min read')
  })
})

// ── wordCountFromContent ──────────────────────────────────────────────────────

describe('wordCountFromContent', () => {
  it('counts zero words in empty string', () => {
    expect(wordCountFromContent('')).toBe(0)
  })

  it('counts words in plain text', () => {
    expect(wordCountFromContent('one two three')).toBe(3)
  })

  it('counts words in Tiptap JSON', () => {
    expect(wordCountFromContent(tiptapDoc('one two three four five'))).toBe(5)
  })

  it('ignores extra whitespace', () => {
    expect(wordCountFromContent('one   two\n\nthree')).toBe(3)
  })
})

// ── countWordsInTiptapContent ─────────────────────────────────────────────────

describe('countWordsInTiptapContent', () => {
  it('returns 0 for empty doc', () => {
    const doc = JSON.stringify({ type: 'doc', content: [] })
    expect(countWordsInTiptapContent(doc)).toBe(0)
  })

  it('counts words in a single text node', () => {
    expect(countWordsInTiptapContent(tiptapDoc('hello world'))).toBe(2)
  })

  it('counts words across multiple paragraphs', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one two' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three four five' }] },
      ],
    })
    expect(countWordsInTiptapContent(doc)).toBe(5)
  })

  it('falls back to plain text on malformed JSON', () => {
    expect(countWordsInTiptapContent('one two three')).toBe(3)
  })

  it('ignores non-text nodes (images, horizontal rules)', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'only these words' }] },
        { type: 'image', attrs: { src: 'img.png' } },
      ],
    })
    expect(countWordsInTiptapContent(doc)).toBe(3)
  })
})

// ── estimateReadingMinutes ────────────────────────────────────────────────────

describe('estimateReadingMinutes', () => {
  it('returns 0 for 0% progress', () => {
    expect(estimateReadingMinutes(tiptapDoc(nWords(1000)), 0)).toBe(0)
  })

  it('returns full minutes for 100% progress', () => {
    // 1000 words / 200wpm = 5 minutes, progress=100%
    expect(estimateReadingMinutes(tiptapDoc(nWords(1000)), 100)).toBeCloseTo(5, 1)
  })

  it('returns half the total for 50% progress', () => {
    // 200 words / 200wpm = 1 minute, 50% → 0.5
    expect(estimateReadingMinutes(tiptapDoc(nWords(200)), 50)).toBeCloseTo(0.5, 2)
  })

  it('clamps progress to 1 when progress > 100', () => {
    const overFull = estimateReadingMinutes(tiptapDoc(nWords(200)), 150)
    const full     = estimateReadingMinutes(tiptapDoc(nWords(200)), 100)
    expect(overFull).toBeCloseTo(full, 5)
  })

  it('clamps progress to 0 when progress < 0', () => {
    expect(estimateReadingMinutes(tiptapDoc(nWords(200)), -10)).toBe(0)
  })

  it('handles empty content gracefully', () => {
    expect(estimateReadingMinutes('', 100)).toBe(0)
  })
})
