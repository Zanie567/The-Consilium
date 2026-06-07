import { describe, it, expect } from 'vitest'
import sanitizeHtml from 'sanitize-html'

/**
 * The article body is assembled by a hand-written TipTap->HTML serializer and then
 * passed through sanitize-html (server-side) before `dangerouslySetInnerHTML`.
 *
 * sanitize-html is used instead of DOMPurify-on-jsdom because jsdom does not load
 * reliably inside the serverless function bundle the article Server Component runs
 * in (it works locally, then throws at request time in production). These tests
 * confirm the sanitiser strips XSS vectors AND preserves every tag/attribute the
 * renderer legitimately emits — a config that stripped figures/footnotes/pull
 * quotes would render every article with missing content.
 *
 * Keep this config identical to SANITIZE_OPTIONS in
 * src/app/articles/[slug]/page.tsx.
 */
const OPTIONS: sanitizeHtml.IOptions = {
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
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
}

describe('article HTML sanitization (sanitize-html, server-side)', () => {
  const clean = (html: string) => sanitizeHtml(html, OPTIONS)

  it('strips <script> tags', () => {
    expect(clean('<p>hi</p><script>alert(1)</script>')).not.toContain('<script')
  })

  it('strips inline event handlers (onerror/onclick)', () => {
    expect(clean('<img src=x onerror="alert(1)">')).not.toMatch(/onerror/i)
  })

  it('strips javascript: hrefs', () => {
    expect(clean('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i)
  })

  it('preserves the structural markup the renderer emits', () => {
    const html =
      '<figure class="article-figure"><img src="https://x.supabase.co/a.png" alt="a" />' +
      '<figcaption class="caption">cap</figcaption>' +
      '<p class="image-credit">Photo: x</p></figure>' +
      '<aside data-type="pull-quote" class="pull-quote">quote</aside>' +
      '<sup class="footnote-ref" data-footnote="n" data-index="1" title="note">[1]</sup>' +
      '<a href="https://example.com" target="_blank" rel="noopener">link</a>' +
      '<p><strong>b</strong><em>i</em><u>u</u><mark>h</mark></p>' +
      '<ol><li>one</li></ol><blockquote><p>q</p></blockquote><hr />'
    const out = clean(html)
    expect(out).toContain('<figure')
    expect(out).toContain('<figcaption')
    expect(out).toContain('<img')
    expect(out).toContain('image-credit')
    expect(out).toContain('data-type="pull-quote"')
    expect(out).toContain('data-footnote')
    expect(out).toContain('data-index="1"')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('<mark>')
    expect(out).toContain('<blockquote>')
  })

  it('keeps relative anchor hrefs (footnote/correction links)', () => {
    expect(clean('<a href="#correction-note">see</a>')).toContain('href="#correction-note"')
  })
})
