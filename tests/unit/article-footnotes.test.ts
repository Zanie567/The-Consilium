import { describe, it, expect } from 'vitest'
import { renderContent, type TiptapNode } from '@/lib/articleRender'

/**
 * Rendering-path tests for footnotes. renderContent is the exact function the
 * public article page uses (moved to src/lib/articleRender.ts so it can be
 * tested), so these exercise the real marker HTML, the real sanitiser pass and
 * the real numbering logic.
 */

function fn(content: string, index = 1): TiptapNode {
  return { type: 'footnoteRef', attrs: { index, content } }
}

function para(...children: (TiptapNode | string)[]): TiptapNode {
  return {
    type: 'paragraph',
    content: children.map((c) => (typeof c === 'string' ? { type: 'text', text: c } : c)),
  }
}

function doc(...content: TiptapNode[]): string {
  return JSON.stringify({ type: 'doc', content })
}

function dataFootnoteOf(html: string, n: number): string {
  const m = html.match(new RegExp(`id="fnref-${n}"[^>]*data-footnote="([^"]*)"`))
    ?? html.match(new RegExp(`data-footnote="([^"]*)"[^>]*id="fnref-${n}"`))
  expect(m, `marker fnref-${n} with data-footnote`).toBeTruthy()
  return m![1]
}

describe('footnote rendering', () => {
  it('renders a single footnote marker with stable anchors and no title attribute', () => {
    const { html, footnotes } = renderContent(doc(para('Inflation rose.', fn('ONS, CPI bulletin, May 2026.'))))
    expect(html).toContain('id="fnref-1"')
    expect(html).toContain('data-index="1"')
    expect(html).toContain('<a href="#fn-1" aria-label="Footnote 1">[1]</a>')
    expect(html).not.toContain('title=')
    expect(footnotes).toEqual([{ index: 1, content: 'ONS, CPI bulletin, May 2026.' }])
  })

  it('numbers several footnotes sequentially in document order', () => {
    const { html, footnotes } = renderContent(
      doc(para('a', fn('first', 1)), para('b', fn('second', 2)), para('c', fn('third', 3)))
    )
    expect(footnotes.map((f) => f.index)).toEqual([1, 2, 3])
    expect(footnotes.map((f) => f.content)).toEqual(['first', 'second', 'third'])
    expect(html).toContain('[1]')
    expect(html).toContain('[2]')
    expect(html).toContain('[3]')
  })

  it('renumbers duplicate and out-of-order stored indices so markers match the list', () => {
    // The editor can leave stale indices behind after deletions: here the
    // stored indices are 5, 2, 2 but the document order is what readers see.
    const { html, footnotes } = renderContent(
      doc(para('a', fn('alpha', 5)), para('b', fn('beta', 2)), para('c', fn('gamma', 2)))
    )
    expect(footnotes).toEqual([
      { index: 1, content: 'alpha' },
      { index: 2, content: 'beta' },
      { index: 3, content: 'gamma' },
    ])
    // Marker n links to entry n, in document order
    expect(html.indexOf('href="#fn-1"')).toBeLessThan(html.indexOf('href="#fn-2"'))
    expect(html.indexOf('href="#fn-2"')).toBeLessThan(html.indexOf('href="#fn-3"'))
    expect(html).not.toContain('data-index="5"')
  })

  it('keeps characters needing escaping intact and never lets footnote text become HTML', () => {
    const nasty = `He said "wait" & then <script>alert('x')</script> > 5 < 6`
    const { html, footnotes } = renderContent(doc(para('x', fn(nasty))))
    // The collected footnote text is the raw string (React escapes it when
    // rendering the list as JSX text).
    expect(footnotes[0].content).toBe(nasty)
    // No executable markup in the article HTML (encodeURIComponent leaves
    // parentheses and quotes alone, but every < and > is percent-encoded)
    expect(html).not.toContain('<script')
    // The data attribute round-trips through decodeURIComponent exactly
    expect(decodeURIComponent(dataFootnoteOf(html, 1))).toBe(nasty)
    // And the encoded form cannot break out of the attribute
    expect(dataFootnoteOf(html, 1)).not.toMatch(/[<>"&]/)
  })

  it('round-trips a footnote containing a URL', () => {
    const withUrl = 'See https://www.ons.gov.uk/economy?type=bulletin&year=2026#cpi for the data.'
    const { html, footnotes } = renderContent(doc(para('x', fn(withUrl))))
    expect(footnotes[0].content).toBe(withUrl)
    expect(decodeURIComponent(dataFootnoteOf(html, 1))).toBe(withUrl)
  })

  it('renders an article with zero footnotes unchanged, with no footnote artifacts', () => {
    const content = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      para('Plain paragraph with '),
      { type: 'blockquote', content: [para('a quote')] }
    )
    const { html, footnotes } = renderContent(content)
    expect(footnotes).toEqual([])
    expect(html).toBe('<h2>Title</h2><p>Plain paragraph with </p><blockquote><p>a quote</p></blockquote>')
    expect(html).not.toContain('footnote')
  })

  it('drops footnotes with empty or whitespace-only text from markers and list alike', () => {
    const { html, footnotes } = renderContent(
      doc(para('a', fn('', 1)), para('b', fn('   ', 2)), para('c', fn('kept', 3)))
    )
    expect(footnotes).toEqual([{ index: 1, content: 'kept' }])
    expect(html).toContain('id="fnref-1"')
    expect(html).not.toContain('fnref-2')
  })

  it('survives the sanitiser: marker structure is preserved end to end', () => {
    const { html } = renderContent(doc(para('x', fn('a note'))))
    // renderContent already sanitises; assert the full marker shape survived
    expect(html).toMatch(
      /<sup class="footnote-ref" id="fnref-1" data-index="1" data-footnote="a%20note"><a href="#fn-1" aria-label="Footnote 1">\[1\]<\/a><\/sup>/
    )
  })
})
