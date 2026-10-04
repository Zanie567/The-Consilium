import sanitizeHtml from 'sanitize-html'
import { SAFE_COLOUR, SAFE_FONT_SIZE, SAFE_FONT_FAMILY, SAFE_LINE_HEIGHT, SAFE_ALIGNMENT } from './articleStyles'

/**
 * Sanitiser for the rendered article body. Keeps the structural tags/attributes
 * the TipTap serializer emits (figure/figcaption/img, sup[data-footnote],
 * aside[data-type], links with target/rel) while stripping scripts, event
 * handlers and unsafe URLs.
 *
 * Uses `sanitize-html` (a pure-JS, htmlparser2-based sanitiser) rather than
 * DOMPurify-on-jsdom: jsdom does not load reliably inside the serverless function
 * bundle the article Server Component runs in (it builds and works locally, then
 * throws at request time in production), which 500'd every article. sanitize-html
 * has no DOM/native dependency, so it runs identically everywhere.
 *
 * Single source of truth: imported by both the article page and its unit tests so
 * the two cannot drift.
 */
export const ARTICLE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  // Exactly the tags nodeToHtml emits — anything else is discarded. The one
  // exception is `span`, allowed solely so the glossary linkifier's injected
  // tooltip triggers (src/lib/glossary/linkify.ts) survive sanitisation if the
  // pipeline is ever reordered to sanitise after linkifying. Its attribute and
  // class allowlists below are deliberately minimal.
  allowedTags: [
    'p', 'br', 'hr',
    'strong', 'em', 'u', 's', 'mark', 'code', 'pre',
    'table', 'colgroup', 'col', 'tbody', 'tr', 'th', 'td',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote',
    'a', 'figure', 'figcaption', 'img', 'aside', 'sup',
    'span',
  ],
  allowedAttributes: {
    // aria-label carries the accessible name of footnote marker links.
    a: ['href', 'target', 'rel', 'aria-label'],
    img: ['src', 'alt'],
    col: ['style'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    p: ['class', 'style'],
    mark: ['style'],
    h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'],
    figure: ['class'],
    figcaption: ['class'],
    aside: ['class', 'data-type'],
    // Footnote markers: id anchors the back-link target (always "fnref-<n>"
    // with a renderer-generated n), data-footnote holds the URI-encoded note
    // text the popover decodes and renders as plain text. The old title
    // attribute is gone on purpose, the popover replaces the native tooltip.
    sup: ['class', 'data-footnote', 'data-index', 'id'],
    // Glossary tooltip triggers only. data-gloss-* values are plain text the
    // tooltip reads via getAttribute/textContent, never interpreted as HTML.
    span: ['style', 'class', 'data-gloss-term', 'data-gloss-def', 'data-gloss-url'],
  },
  // A span may only carry the glossary trigger class; anything else (including
  // a class-less span from pasted content) is stripped to its text.
  allowedClasses: {
    span: ['glossary-term'],
  },
  allowedStyles: {
    col: { width: [/^(?:[2-9]\d|[1-9]\d{2}|1\d{3}|2000)px$/] },
    '*': { color: [SAFE_COLOUR], 'background-color': [SAFE_COLOUR],
      'font-size': [SAFE_FONT_SIZE], 'font-family': [SAFE_FONT_FAMILY],
      'line-height': [SAFE_LINE_HEIGHT], 'text-align': [SAFE_ALIGNMENT] },
  },
  // Only safe URL schemes; relative/anchor hrefs (e.g. #correction-note) still pass.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, ARTICLE_SANITIZE_OPTIONS)
}
