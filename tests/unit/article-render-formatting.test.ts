import { describe, it, expect } from 'vitest'
import { renderContent, type TiptapNode } from '@/lib/articleRender'

/**
 * What the public renderer does with each editor feature. The editor (TiptapEditor)
 * offers strikethrough, tables, code blocks, inline code, text colour, highlight,
 * alignment and line spacing. Decision recorded with the owner (see
 * docs/testing/coverage-inventory.md):
 *   - semantic features (strikethrough, tables, code) are PUBLISHED, because dropping
 *     them changes what the article says (struck-out text reading as asserted, a table
 *     collapsing into a run-on string);
 *   - presentation (text colour, alignment, line spacing, font size) is STRIPPED: the
 *     published article uses the house style.
 */
const doc = (...content: TiptapNode[]) => JSON.stringify({ type: 'doc', content })
const text = (value: string, ...marks: TiptapNode['marks'] extends (infer M)[] | undefined ? M[] : never) =>
  ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) }) as TiptapNode
const para = (...children: TiptapNode[]): TiptapNode => ({ type: 'paragraph', content: children })
const html = (...content: TiptapNode[]) => renderContent(doc(...content)).html

describe('semantic formatting is published', () => {
  it('renders strikethrough as <s>', () => {
    expect(html(para(text('retracted', { type: 'strike' })))).toContain('<s>retracted</s>')
  })

  it('renders inline code as <code>', () => {
    expect(html(para(text('x = 1', { type: 'code' })))).toContain('<code>x = 1</code>')
  })

  it('renders a code block as <pre><code> and keeps its line breaks and escaping', () => {
    const out = html({
      type: 'codeBlock',
      content: [{ type: 'text', text: 'if (a < b) {\n  go()\n}' }],
    })
    expect(out).toContain('<pre><code>')
    expect(out).toContain('if (a &lt; b) {\n  go()\n}')
  })

  it('renders a table with header and body cells in their rows', () => {
    const cell = (type: 'tableHeader' | 'tableCell', value: string): TiptapNode => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [para(text(value))],
    })
    const out = html({
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Region'), cell('tableHeader', 'Rate')] },
        { type: 'tableRow', content: [cell('tableCell', 'UK'), cell('tableCell', '5.25')] },
      ],
    })
    expect(out).toContain('<table>')
    expect(out).toMatch(/<tr><th[^>]*>.*Region.*<\/th><th[^>]*>.*Rate.*<\/th><\/tr>/)
    expect(out).toMatch(/<tr><td[^>]*>.*UK.*<\/td><td[^>]*>.*5\.25.*<\/td><\/tr>/)
    // Cell text must stay separated by cell markup, not run together as "RegionRateUK5.25".
    expect(out).not.toContain('RegionRate')
  })

  it('keeps column and row spans on cells', () => {
    const out = html({
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [{ type: 'tableCell', attrs: { colspan: 2, rowspan: 3 }, content: [para(text('wide'))] }],
      }],
    })
    expect(out).toMatch(/<td[^>]*colspan="2"/)
    expect(out).toMatch(/<td[^>]*rowspan="3"/)
  })

  it('does not let a cell attribute carry markup or script', () => {
    const out = html({
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [{ type: 'tableCell', attrs: { colspan: '2" onclick="alert(1)', rowspan: 1 }, content: [para(text('x'))] }],
      }],
    })
    expect(out).not.toMatch(/onclick/i)
  })
})

describe('presentation is stripped (house style)', () => {
  it('drops text colour', () => {
    const out = html(para(text('red', { type: 'textStyle', attrs: { color: '#ff0000' } })))
    expect(out).toContain('red')
    expect(out).not.toMatch(/color|style=|#ff0000/i)
  })

  it('drops alignment on paragraphs and headings', () => {
    const out = html(
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('centred')] },
      { type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [text('right')] },
    )
    expect(out).not.toMatch(/text-align|style=|center|right"/i)
    expect(out).toContain('<p>centred</p>')
  })

  it('drops line spacing and font size', () => {
    const out = html(para(text('spaced', { type: 'textStyle', attrs: { lineHeight: '2', fontSize: '24px' } })))
    expect(out).not.toMatch(/line-height|font-size|style=/i)
  })

  it('renders highlight as the site mark, ignoring the chosen colour', () => {
    const out = html(para(text('hi', { type: 'highlight', attrs: { color: '#ffff00' } })))
    expect(out).toContain('<mark>hi</mark>')
    expect(out).not.toContain('#ffff00')
  })
})
