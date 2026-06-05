import { describe, it, expect } from 'vitest'
import DOMPurify from 'isomorphic-dompurify'

/**
 * The article body is assembled by a hand-written TipTap->HTML serializer and then
 * passed through DOMPurify (server-side) before `dangerouslySetInnerHTML`. These
 * tests confirm the sanitizer actually runs in the Node/SSR context the article
 * page renders in, and strips the XSS vectors the renderer aims to prevent.
 */
describe('article HTML sanitization (isomorphic-dompurify, server-side)', () => {
  const clean = (html: string) =>
    DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ADD_TAGS: ['figure', 'figcaption'] })

  it('strips <script> tags', () => {
    expect(clean('<p>hi</p><script>alert(1)</script>')).not.toContain('<script')
  })

  it('strips inline event handlers (onerror/onclick)', () => {
    const out = clean('<img src=x onerror="alert(1)">')
    expect(out).not.toMatch(/onerror/i)
  })

  it('strips javascript: hrefs', () => {
    const out = clean('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toMatch(/javascript:/i)
  })

  it('preserves the structural markup the renderer emits', () => {
    const html =
      '<figure class="article-figure"><img src="https://x.supabase.co/a.png" alt="a" />' +
      '<figcaption class="caption">cap</figcaption></figure>' +
      '<sup class="footnote-ref" data-footnote="n" data-index="1">[1]</sup>' +
      '<a href="https://example.com" target="_blank" rel="noopener">link</a>'
    const out = clean(html)
    expect(out).toContain('<figure')
    expect(out).toContain('<figcaption')
    expect(out).toContain('data-footnote')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
  })
})
