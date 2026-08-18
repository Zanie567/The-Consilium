import { describe, it, expect } from 'vitest'
import { canonicalAlternates, pageOpenGraph, NOINDEX_ROBOTS } from '@/lib/seo'

/**
 * Guards a site-wide SEO bug in both its directions. Next merges metadata
 * shallowly, so:
 *
 *   * the root layout's `alternates.canonical` was inherited by every page that
 *     did not set its own, making the whole site declare itself a duplicate of
 *     the homepage; and
 *   * a page setting a partial `openGraph` REPLACED the root object, which is
 *     how the homepage came to ship no og:image.
 *
 * Both helpers exist so a call site cannot produce half an object.
 */
describe('canonicalAlternates', () => {
  it('returns the path as a root-relative canonical', () => {
    expect(canonicalAlternates('/about').canonical).toBe('/about')
  })

  it('preserves a query string, so paginated URLs self-canonicalise', () => {
    expect(canonicalAlternates('/archive?page=2').canonical).toBe('/archive?page=2')
  })

  it('roots a path that was passed without a leading slash', () => {
    expect(canonicalAlternates('about').canonical).toBe('/about')
  })

  it('always re-declares the RSS alternate the root layout would otherwise supply', () => {
    // Setting `alternates` replaces the inherited object wholesale, so omitting
    // this would silently drop the feed link from every page with a canonical.
    expect(canonicalAlternates('/about').types).toMatchObject({
      'application/rss+xml': expect.stringContaining('/feed.xml'),
    })
  })
})

describe('pageOpenGraph', () => {
  it('always includes the shared fields a partial object would have dropped', () => {
    const og = pageOpenGraph('/about')
    expect(og).toMatchObject({ type: 'website', locale: 'en_GB', url: '/about' })
    expect(og?.siteName).toBeTruthy()
    expect(og?.images).toHaveLength(1)
  })

  it('applies title and description overrides without losing the image', () => {
    const og = pageOpenGraph('/', { title: 'The Consilium', description: 'Ratione et Consilio' })
    expect(og).toMatchObject({ title: 'The Consilium', description: 'Ratione et Consilio' })
    expect(og?.images).toHaveLength(1)
  })
})

describe('NOINDEX_ROBOTS', () => {
  it('keeps pages crawlable while out of the index', () => {
    expect(NOINDEX_ROBOTS).toEqual({ index: false, follow: true })
  })
})
