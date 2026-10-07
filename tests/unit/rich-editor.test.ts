// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TiptapNode } from '@/lib/richContent'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { FigureNode } from '@/components/editor/extensions/FigureNode'
import { ArticleTable } from '@/components/editor/extensions/ArticleTable'
import { cleanPastedHTML } from '@/lib/editor/cleanPastedHTML'
import { renderContent } from '@/lib/articleRender'
import { figureAltError } from '@/lib/figureValidation'
import { safeContentUrl } from '@/lib/richMetadata'
const fixture = readFileSync('tests/fixtures/google-docs-economics.html', 'utf8')
const extensions = () => [StarterKit, ArticleTable, TableRow, TableHeader, TableCell]
describe('native figure defaults', () => {
  it('keeps paragraphs as the default block in empty documents and table cells', () => {
    const editor = new Editor({ extensions: [...extensions(), FigureNode], content: '' })
    expect(editor.getJSON().content?.[0].type).toBe('paragraph')
    editor.commands.insertTable({ rows: 2, cols: 3, withHeaderRow: true })
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"figure"')
    editor.destroy()
  })
})
describe('Google Docs structure and repeated native JSON round-trips', () => {
  it('preserves headings, paragraphs, bold/italic, links, lists and a 3-column header table', () => {
    const cleaned = cleanPastedHTML(fixture)
    expect(cleaned).not.toMatch(/style=|class=|onclick=|script|iframe|data-tracking|docs-/)
    const editor = new Editor({ extensions: extensions(), content: cleaned })
    try {
      const doc: TiptapNode = JSON.parse(JSON.stringify(editor.getJSON()))
      const table = doc.content?.find((n) => n.type === 'table')
      expect(table?.content).toHaveLength(4)
      expect(table?.content?.every((row) => row.content?.length === 3)).toBe(true)
      expect(table?.content?.[0].content?.every((cell) => cell.type === 'tableHeader')).toBe(true)
      for (const type of ['heading', 'paragraph', 'orderedList', 'bulletList', 'blockquote'])
        expect(doc.content?.some((n) => n.type === type)).toBe(true)
      const json = JSON.stringify(doc)
      expect(json).toContain('"type":"bold"')
      expect(json).toContain('"type":"italic"')
      expect(json).toContain('https://www.ons.gov.uk/')
      let saved = json
      for (let i = 0; i < 3; i++) {
        const reopened = new Editor({ extensions: extensions(), content: JSON.parse(saved) })
        saved = JSON.stringify(reopened.getJSON())
        reopened.destroy()
      }
      expect(saved).toBe(json)
      const html = renderContent(saved).html
      const container = document.createElement('div')
      container.innerHTML = html
      expect(container.querySelectorAll('table tr')).toHaveLength(4)
      expect(container.querySelectorAll('table th')).toHaveLength(3)
      expect(container.querySelector('td a')?.getAttribute('href')).toBe('https://www.ons.gov.uk/')
      expect(html).toContain('role="region"')
      expect(html).toContain('tabindex="0"')
    } finally {
      editor.destroy()
    }
  })
  it.each([
    '<table><tr><td><b>broken',
    '<img src="javascript:x" onerror="x"><svg onload="x"><script>x</script></svg>',
    '<a href="java&#x09;script:alert(1)">text</a>',
    '<form><input onfocus="x"></form><p>safe</p>',
  ])('sanitises malformed clipboard %s', (html) => {
    expect(cleanPastedHTML(html)).not.toMatch(
      /javascript:|onerror|onload|onfocus|script|<svg|<form|<input/
    )
  })
  it('keeps styled bold links and removes attributes without deleting their text', () => {
    expect(
      cleanPastedHTML(
        '<a id="google-link" style="font-weight:700" href="https://example.com">Useful</a>'
      )
    ).toBe('<a href="https://example.com"><strong>Useful</strong></a>')
  })
})
describe('public rich-content safety and parity', () => {
  it('does not silently discard persisted rows or cells from large tables', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const doc = { type: 'doc', content: [
      { type: 'table', content: Array.from({ length: 501 }, (_, i) => ({ type: 'tableRow', content: [cell(`Row ${i}`)] })) },
      { type: 'table', content: [{ type: 'tableRow', content: Array.from({ length: 101 }, (_, i) => cell(`Column ${i}`)) }] },
    ] }
    const container = document.createElement('div')
    container.innerHTML = renderContent(JSON.stringify(doc)).html
    expect(container.querySelectorAll('table')[0].querySelectorAll('tr')).toHaveLength(501)
    expect(container.querySelectorAll('table')[1].querySelectorAll('td')).toHaveLength(101)
    expect(container.textContent).toContain('Row 500')
    expect(container.textContent).toContain('Column 100')
  })
  it('drops empty tables', () =>
    expect(renderContent('{"type":"doc","content":[{"type":"table","content":[]}]}').html).toBe(''))
  it('renders safe attached table metadata only when present', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: {
            caption: 'CPI table',
            source: 'ONS',
            sourceUrl: 'https://www.ons.gov.uk',
            note: 'Rounded',
          },
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      ],
    }
    const html = renderContent(JSON.stringify(doc)).html
    expect(html).toContain('CPI table')
    expect(html).toContain('Source:')
    expect(html).toContain('Note: Rounded')
  })
  it('publishes semantic toolbar marks using house style and rejects injected styles', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'Text',
              marks: [
                { type: 'strike' },
                {
                  type: 'textStyle',
                  attrs: { color: '#ff0000', fontSize: '24px', lineHeight: '1.5' },
                },
              ],
            },
          ],
        },
      ],
    }
    const html = renderContent(JSON.stringify(doc)).html
    expect(html).toContain('<s>Text</s>')
    expect(html).not.toMatch(/style=|text-align|font-size|color:/)
    doc.content[0].attrs.textAlign = 'center; background:url(javascript:x)'
    expect(renderContent(JSON.stringify(doc)).html).not.toContain('javascript')
  })
  it.each([
    'javascript:alert(1)',
    '//tracking.example.test/x',
    'https://user:pass@example.com',
    'data:image/svg+xml,x',
    'java\tscript:x',
  ])('rejects unsafe metadata URL %s', (url) => expect(safeContentUrl(url)).toBeUndefined())
  it('requires useful figure alt unless explicitly decorative; drafts still retain legacy text', () => {
    const figure = {
      type: 'doc',
      content: [{ type: 'figure', attrs: { src: '/image.png', alt: '', decorative: false } }],
    }
    expect(figureAltError(JSON.stringify(figure))).toContain('alternative text')
    figure.content[0].attrs.decorative = true
    expect(figureAltError(JSON.stringify(figure))).toBeUndefined()
    expect(figureAltError('legacy plain content')).toBeUndefined()
  })
})
