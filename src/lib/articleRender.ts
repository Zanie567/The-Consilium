import { escapeHtml as escHtml } from '@/lib/escapeHtml'
import { sanitizeArticleHtml } from '@/lib/articleSanitize'
import { renderArticleTable } from '@/lib/tableRender'
import { renderArticleFigure } from '@/lib/figureRender'
import type { TiptapNode } from '@/lib/richContent'
export type { TiptapNode } from '@/lib/richContent'

/**
 * TipTap JSON -> article HTML renderer, shared by the public article page and
 * its unit tests. Moved out of src/app/articles/[slug]/page.tsx verbatim so the
 * rendering path can be tested directly; the logic is unchanged except for the
 * footnoteRef branch (see below).
 *
 * Footnotes are numbered at render time, in document order, ignoring the index
 * stored by the editor. The editor assigns indices at insertion and never
 * renumbers, so deleting or reordering footnotes leaves stored indices stale
 * (duplicates, gaps, out-of-order). Numbering here guarantees the markers and
 * the references list at the bottom always agree: marker [n] is entry n.
 *
 * Each marker carries stable anchors (sup id="fnref-n", inner link to "#fn-n")
 * so the page can wire marker clicks to the list and back-links to the marker.
 * The footnote text travels in data-footnote, URI-encoded; the popover decodes
 * it and renders it via textContent only, never as HTML.
 */

function safeHref(href: string): string {
  // Strip control characters (tab/newline/CR/null) that browsers ignore inside a
  // URL scheme — otherwise `java\tscript:` would slip past a naive prefix check.
  const cleaned = href.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  // If an explicit scheme is present, allow only safe ones; relative/anchor/
  // protocol-relative URLs (no scheme) pass through.
  const scheme = cleaned.match(/^([a-z][a-z0-9+.-]*):/i)
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) {
    return '#'
  }
  return cleaned
}

export interface ArticleFootnote {
  index: number
  content: string
}

interface RenderState {
  footnotes: ArticleFootnote[]
}

function blockStyle(node: TiptapNode): string {
  const alignment = node.attrs?.textAlign
  return typeof alignment === 'string' && ['left', 'right', 'center', 'justify'].includes(alignment)
    ? ` style="text-align:${alignment}"`
    : ''
}

function nodeToHtml(node: TiptapNode, state: RenderState): string {
  switch (node.type) {
    case 'paragraph': {
      const inner = node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''
      if (!inner.trim()) return ''
      return `<p${blockStyle(node)}>${inner}</p>`
    }
    case 'heading': {
      // Clamp to a valid h1-h6: the level is interpolated into the tag name, so an
      // unvalidated attribute (e.g. level = "1><img onerror=...>") would inject markup.
      const raw = Number(node.attrs?.level)
      const level = Number.isFinite(raw) ? Math.min(6, Math.max(1, Math.trunc(raw))) : 2
      return `<h${level}${blockStyle(node)}>${node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''}</h${level}>`
    }
    case 'text': {
      let text = escHtml(node.text ?? '')
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'bold') text = `<strong>${text}</strong>`
          if (mark.type === 'italic') text = `<em>${text}</em>`
          if (mark.type === 'strike') text = `<s>${text}</s>`
          if (mark.type === 'code') text = `<code>${text}</code>`
          if (mark.type === 'underline') text = `<u>${text}</u>`
          if (mark.type === 'highlight') {
            const color = String(mark.attrs?.color ?? '')
            text = `<mark${/^#[0-9a-f]{3,8}$/i.test(color) ? ` style="background-color:${color}"` : ''}>${text}</mark>`
          }
          if (mark.type === 'textStyle') {
            const styles: string[] = []
            const color = String(mark.attrs?.color ?? '')
            const size = String(mark.attrs?.fontSize ?? '')
            const height = String(mark.attrs?.lineHeight ?? '')
            if (/^#[0-9a-f]{3,8}$/i.test(color)) styles.push(`color:${color}`)
            if (/^\d+(\.\d+)?px$/.test(size) && parseFloat(size) >= 12 && parseFloat(size) <= 96)
              styles.push(`font-size:${size}`)
            if (/^\d+(\.\d+)?$/.test(height) && Number(height) >= 1 && Number(height) <= 3)
              styles.push(`line-height:${height}`)
            if (styles.length) text = `<span style="${styles.join(';')}">${text}</span>`
          }
          if (mark.type === 'link') {
            const href = safeHref(String(mark.attrs?.href ?? '#'))
            const target = escHtml(String(mark.attrs?.target ?? '_self'))
            text = `<a href="${escHtml(href)}" target="${target}" rel="noopener">${text}</a>`
          }
        }
      }
      return text
    }
    case 'bulletList':
      return `<ul>${node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''}</ul>`
    case 'orderedList':
      return `<ol${Number.isInteger(node.attrs?.start) && Number(node.attrs?.start) > 1 ? ` start="${Math.min(100000, Number(node.attrs?.start))}"` : ''}>${node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''}</ol>`
    case 'listItem':
      return `<li>${node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''}</li>`
    case 'blockquote':
      return `<blockquote>${node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''}</blockquote>`
    case 'horizontalRule':
      return `<hr />`
    case 'table':
      return renderArticleTable(node, (n) => nodeToHtml(n, state))
    case 'codeBlock':
      return `<pre><code>${escHtml(node.content?.map((n) => n.text ?? '').join('') ?? '')}</code></pre>`
    case 'image':
      return renderArticleFigure(node.attrs, true)
    case 'figure':
      return renderArticleFigure(node.attrs)
    case 'hardBreak':
      return `<br />`
    case 'pullQuote':
      return `<aside data-type="pull-quote" class="pull-quote">${node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''}</aside>`
    case 'footnoteRef': {
      const content = String(node.attrs?.content ?? '').trim()
      // A footnote with no text would produce a marker pointing at an empty
      // entry, so it is dropped from the rendered article entirely.
      if (!content) return ''
      const n = state.footnotes.length + 1
      state.footnotes.push({ index: n, content })
      // data-footnote is URI-encoded: encodeURIComponent's output alphabet
      // (alphanumerics, %xx, !'()*-._~) cannot break out of a double-quoted
      // attribute, and the popover decodes it back to the exact original text.
      return (
        `<sup class="footnote-ref" id="fnref-${n}" data-index="${n}" data-footnote="${encodeURIComponent(content)}">` +
        `<a href="#fn-${n}" aria-label="Footnote ${n}">[${n}]</a></sup>`
      )
    }
    // chartNode: silently drop - data callout has been removed
    case 'chartNode':
      return ''
    default:
      return node.content?.map((n) => nodeToHtml(n, state)).join('') ?? ''
  }
}

export function renderContent(content: string): { html: string; footnotes: ArticleFootnote[] } {
  try {
    const parsed = JSON.parse(content)
    if (parsed?.type === 'doc') {
      const state: RenderState = { footnotes: [] }
      const html = ((parsed.content ?? []) as TiptapNode[])
        .map((n) => nodeToHtml(n, state))
        .join('')
      // Defense-in-depth: even though nodeToHtml escapes text and validates hrefs,
      // run the assembled HTML through the sanitiser so any future renderer gap (a
      // new node type, an unescaped attribute) cannot become stored XSS.
      return { html: sanitizeArticleHtml(html), footnotes: state.footnotes }
    }
  } catch {}
  // Fallback: treat as plain text — escape to prevent XSS from raw stored strings
  return { html: escHtml(content), footnotes: [] }
}
