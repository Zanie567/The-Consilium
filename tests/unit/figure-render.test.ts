import { describe, expect, it } from 'vitest'
import { renderContent } from '@/lib/articleRender'
import type { TiptapNode } from '@/lib/richContent'

function render(nodes: TiptapNode[]) {
  return renderContent(JSON.stringify({ type: 'doc', content: nodes })).html
}

describe('figure extraction preserves stored-document rendering', () => {
  it('keeps independent caption/credit/alt values on multiple figures', () => {
    const html = render([
      {
        type: 'figure',
        attrs: {
          src: 'https://example.com/one.png',
          alt: 'First chart',
          caption: 'First',
          credit: 'Jane',
        },
      },
      {
        type: 'figure',
        attrs: {
          src: 'https://example.com/two.png',
          alt: 'Second chart',
          caption: 'Second',
          credit: 'Jo',
        },
      },
    ])
    expect(html).toBe(
      '<figure class="article-figure"><img src="https://example.com/one.png" alt="First chart" />' +
        '<figcaption class="caption">First</figcaption><p class="image-credit">Credit: Jane</p></figure>' +
        '<figure class="article-figure"><img src="https://example.com/two.png" alt="Second chart" />' +
        '<figcaption class="caption">Second</figcaption><p class="image-credit">Credit: Jo</p></figure>'
    )
  })

  it('retains legacy image nodes without manufacturing empty metadata', () => {
    const html = render([{ type: 'image', attrs: { src: '/legacy.png', alt: 'Legacy' } }])
    expect(html).toBe(
      '<figure class="article-figure"><img src="/legacy.png" alt="Legacy" /></figure>'
    )
  })

  it('escapes figure metadata and still applies the server URL sanitizer', () => {
    const html = render([
      {
        type: 'figure',
        attrs: {
          src: 'javascript:alert(1)',
          alt: '" onerror="bad',
          caption: '<script>bad</script>',
          credit: '<img src=x onerror=bad>',
        },
      },
    ])
    expect(html).not.toContain('src="javascript:')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect(html).not.toContain('<img')
    const validImage = render([
      { type: 'figure', attrs: { src: '/safe.png', alt: '" onerror="bad' } },
    ])
    expect(validImage).toContain('alt="&quot; onerror=&quot;bad"')
    expect(validImage).not.toContain(' onerror="bad"')
  })
})
