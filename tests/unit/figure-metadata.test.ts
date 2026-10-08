import { describe, expect, it } from 'vitest'
import { renderContent } from '@/lib/articleRender'
import { articleImagePath, articleImageReferences } from '@/lib/articleImageStorage'
import { detectImageMimeType } from '@/lib/imageSniff'
import { vi } from 'vitest'
describe('structured figure metadata and managed keys', () => {
  it('renders chart metadata independently, strips blank labels and validates dimensions/source links', () => {
    const html = renderContent(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'figure',
            attrs: {
              src: '/chart.png',
              alt: 'CPI falls from 3 to 2 percent',
              caption: 'UK CPI',
              source: 'Bank of England',
              sourceUrl: 'https://www.bankofengland.co.uk/',
              credit: 'The Consilium',
              note: 'Forecast begins in 2027',
              width: 1200,
              height: 800,
            },
          },
          {
            type: 'figure',
            attrs: {
              src: '/decorative.png',
              alt: 'Ignored',
              decorative: true,
              caption: ' ',
              source: '',
              credit: '',
              note: '',
              width: -1,
              height: '100 onerror=x',
            },
          },
        ],
      })
    ).html
    expect(html).toContain('alt="CPI falls from 3 to 2 percent"')
    expect(html).toContain('width="1200" height="800"')
    expect(html).toContain('Source: <a href="https://www.bankofengland.co.uk/"')
    expect(html).toContain('Credit: The Consilium')
    expect(html).toContain('Note: Forecast begins in 2027')
    expect(html.split('<figure')[2]).toBe(
      ' class="article-figure"><img src="/decorative.png" alt="" /></figure>'
    )
  })
  it('supports metadata-only figures without broken or empty image elements', () => {
    const content = (attrs: object) =>
      renderContent(JSON.stringify({ type: 'doc', content: [{ type: 'figure', attrs }] })).html
    expect(content({ caption: 'A statistical note', source: 'Bank of England' })).toContain(
      'A statistical note'
    )
    expect(content({ caption: 'A statistical note' })).not.toContain('<img')
    expect(content({ src: 'javascript:alert(1)' })).toBe('')
    expect(content({})).toBe('')
  })
  it('only recognises owner-scoped managed URLs, never legacy/foreign/path-traversal keys', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example.test')
    const url =
      'https://storage.example.test/storage/v1/object/public/article-images/owner/11111111-1111-4111-8111-111111111111.png'
    expect(articleImagePath(url, 'owner')).toBe('owner/11111111-1111-4111-8111-111111111111.png')
    expect(articleImagePath(url, 'other')).toBeUndefined()
    expect(articleImagePath(url + '?x#fragment')).toBe(articleImagePath(url))
    expect(articleImagePath(url.replace('/owner/', '/%6Fwner%2F'))).toBe(articleImagePath(url))
    expect(articleImagePath(url.replace('https://', 'https://user:pass@'))).toBeUndefined()
    expect(articleImagePath(url.replace('owner/', '../'))).toBeUndefined()
    expect(
      articleImagePath(
        'https://storage.example.test/storage/v1/object/public/article-images/old.png'
      )
    ).toBeUndefined()
    expect(
      articleImageReferences(
        JSON.stringify({
          type: 'doc',
          content: [
            { type: 'figure', attrs: { src: url } },
            { type: 'image', attrs: { src: url + '?download=1' } },
            { type: 'figure', attrs: { src: url.replace('/owner/', '/%6Fwner%2F') } },
          ],
        }),
        url
      )
    ).toEqual([url])
    vi.unstubAllEnvs()
  })
  it('rejects generic HEIF/QuickTime ftyp signatures while accepting AVIF brands', () => {
    const bytes = new Uint8Array(24)
    new DataView(bytes.buffer).setUint32(0, 24)
    bytes.set(new TextEncoder().encode('ftyp'), 4)
    bytes.set(new TextEncoder().encode('qt  '), 8)
    expect(detectImageMimeType(bytes)).toBeNull()
    bytes.set(new TextEncoder().encode('avif'), 16)
    expect(detectImageMimeType(bytes)).toBe('image/avif')
  })
})
