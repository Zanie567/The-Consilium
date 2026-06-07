import sanitizeHtml from 'sanitize-html'

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
  // Exactly the tags nodeToHtml emits — anything else is discarded.
  allowedTags: [
    'p', 'br', 'hr',
    'strong', 'em', 'u', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote',
    'a', 'figure', 'figcaption', 'img', 'aside', 'sup',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt'],
    p: ['class'],
    figure: ['class'],
    figcaption: ['class'],
    aside: ['class', 'data-type'],
    sup: ['class', 'data-footnote', 'data-index', 'title'],
  },
  // Only safe URL schemes; relative/anchor hrefs (e.g. #correction-note) still pass.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, ARTICLE_SANITIZE_OPTIONS)
}
