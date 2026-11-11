import { escapeHtml } from '@/lib/escapeHtml'
import { MAX_LATEX_LENGTH, renderLatex } from '@/lib/math/latex'
import { sanitizeKatexHtml } from '@/lib/math/katexSanitize'

/**
 * Server-side typesetting of an article's equations into their final public HTML.
 *
 *   inline : <span class="math-inline"><span class="katex">…</span></span>
 *   display: <div class="math-display"><span class="katex-display">…</span></div>
 *
 * The .katex markup holds MathML (read by screen readers) beside the visual HTML
 * (aria-hidden), so readers get typeset maths with no client-side JavaScript.
 *
 * An equation that cannot be typeset (malformed or unsupported LaTeX, or input
 * over the limits in latex.ts) never breaks the page: it is shown as its LaTeX
 * source in a <code> element, escaped, so the text is still readable and the
 * stored source is untouched for an editor to correct.
 *
 * Results are memoised per server instance. Public article pages are CDN-cached,
 * so this only runs when a page is regenerated; the cache spares the CPU of
 * typesetting the same equations again for other pages or regenerations.
 */

const CACHE_LIMIT = 500
const CACHEABLE_LENGTH = 60_000
const cache = new Map<string, string>()

function remember(key: string, html: string): string {
  if (html.length > CACHEABLE_LENGTH) return html
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, html)
  return html
}

function fallback(latex: string, display: boolean): string {
  const source = escapeHtml(latex.length > MAX_LATEX_LENGTH ? `${latex.slice(0, MAX_LATEX_LENGTH)}…` : latex)
  return display
    ? `<div class="math-display math-error"><code>${source}</code></div>`
    : `<span class="math-inline math-error"><code>${source}</code></span>`
}

/** Final HTML for one stored equation. Empty or non-string LaTeX renders as nothing. */
export function renderArticleMath(latex: unknown, display: boolean): string {
  if (typeof latex !== 'string' || !latex.trim()) return ''
  // Over-long input is refused by renderLatex anyway; skip the cache so it cannot hold huge keys.
  if (latex.length > MAX_LATEX_LENGTH) return fallback(latex, display)
  const key = `${display ? 'D' : 'I'}${latex}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Refresh recency so frequently used equations stay cached.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const result = renderLatex(latex, display)
  if (!result.ok) return remember(key, fallback(latex, display))
  const katexHtml = sanitizeKatexHtml(result.html)
  return remember(
    key,
    display
      ? `<div class="math-display">${katexHtml}</div>`
      : `<span class="math-inline">${katexHtml}</span>`,
  )
}
