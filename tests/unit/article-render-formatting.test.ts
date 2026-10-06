import { describe, it, expect } from 'vitest'
import { renderContent, type TiptapNode } from '@/lib/articleRender'

/**
 * What the public renderer does with each editor feature. The editor (TiptapEditor)
 * offers strikethrough, tables, code blocks, inline code, text colour, highlight,
 * alignment and line spacing. Owner instruction for this audit (see
 * docs/testing/coverage-inventory.md):
 *   - semantic features (strikethrough, tables, code) are PUBLISHED, because dropping
 *     them changes what the article says (struck-out text reading as asserted, a table
 *     collapsing into a run-on string);
 *   - presentation is preserved using an explicit safe CSS value contract.
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

describe('editor presentation is published safely', () => {
  it('keeps colour, font size, family and spacing', () => {
    const out = html(para(text('styled', { type: 'textStyle', attrs: { color: '#ff0000', fontSize: '24px', fontFamily: 'Georgia', lineHeight: '2' } })))
    for (const value of ['color:#ff0000', 'font-size:24px', 'font-family:Georgia', 'line-height:2']) expect(out).toContain(value)
  })
  it('keeps paragraph and heading alignment', () => {
    expect(html({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('x')] })).toContain('text-align:center')
    expect(html({ type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [text('x')] })).toContain('text-align:right')
  })
  it('keeps highlight colour', () => {
    expect(html(para(text('hi', { type: 'highlight', attrs: { color: '#ffff00' } })))).toContain('background-color:#ffff00')
  })
  it.each(['url(https://evil.test)', 'red;position:fixed', '\" onclick=\"alert(1)', 'expression(alert(1))', '9999px'])('rejects hostile or out-of-contract CSS: %s', value => {
    const out = html(para(text('safe', { type: 'textStyle', attrs: { color: value, fontSize: value, lineHeight: value, fontFamily: value } })))
    expect(out).not.toContain('style=')
    expect(out).not.toContain('onclick')
    expect(out).toContain('safe')
  })
})

it('preserves bounded resized table columns and rejects hostile widths',()=>{
 const table=(colwidth:unknown)=>({type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colwidth},content:[para(text('cell'))]}]}]})
 expect(html(table([180]))).toContain('<col style="width:180px"')
 for(const value of [['180px;position:fixed'],[10000],[-1]])expect(html(table(value))).not.toContain('style=')
})
