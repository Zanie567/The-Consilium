import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/constants'

/**
 * Per-page metadata helpers.
 *
 * Next merges metadata SHALLOWLY — see the "Merging" section of
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md
 * — which cuts both ways and bit this site in both directions:
 *
 *   * A page that does NOT set `alternates` inherits the root layout's object
 *     whole. The root used to pin `canonical: SITE_URL`, so every article,
 *     category, tag and author page declared itself a duplicate of the
 *     homepage.
 *   * A page that DOES set a partial object REPLACES the root's wholesale. The
 *     homepage set `openGraph: { title, description }` and thereby dropped the
 *     site's og:image, siteName, locale and type.
 *
 * Building these objects here rather than by hand at each call site is what
 * stops the next page from reintroducing either half.
 */

/** The feed link the root layout advertises; re-declared by any page that sets `alternates`. */
const RSS_ALTERNATE_TYPES = { 'application/rss+xml': `${SITE_URL}/feed.xml` }

/** The site's fallback share image, used whenever a page has nothing better. */
const DEFAULT_OG_IMAGE = {
  url: '/logo.png',
  width: 512,
  height: 512,
  alt: `${SITE_NAME} logo`,
}

/**
 * Build a page's `alternates`: a self-referencing canonical plus the site-wide
 * RSS link.
 *
 * `path` is root-relative (`/articles/my-slug`, `/archive?page=2`); the root
 * layout's `metadataBase` resolves it against SITE_URL, so callers never
 * hardcode the origin.
 */
export function canonicalAlternates(path: string): NonNullable<Metadata['alternates']> {
  return {
    canonical: path.startsWith('/') ? path : `/${path}`,
    types: { ...RSS_ALTERNATE_TYPES },
  }
}

/**
 * Build a complete `openGraph` object for a page.
 *
 * Always returns every shared field, so a caller that only wants to override
 * the title cannot silently drop the share image the way a hand-written
 * partial object does.
 */
export function pageOpenGraph(
  path: string,
  overrides: { title?: string; description?: string } = {}
): Metadata['openGraph'] {
  return {
    title: overrides.title ?? SITE_NAME,
    description: overrides.description ?? SITE_DESCRIPTION,
    type: 'website',
    locale: 'en_GB',
    url: path.startsWith('/') ? path : `/${path}`,
    siteName: SITE_NAME,
    images: [DEFAULT_OG_IMAGE],
  }
}

/**
 * Metadata for a page that must stay out of search results — auth screens,
 * one-off token links, and anything user-specific. `follow: true` still lets
 * crawlers traverse the site's navigation from the page.
 *
 * No canonical: a page that should not be indexed has no business nominating
 * an indexable URL.
 */
export const NOINDEX_ROBOTS: NonNullable<Metadata['robots']> = { index: false, follow: true }

/** As above, for pages whose outgoing links are private too (admin, portal, tokens). */
export const NOINDEX_NOFOLLOW_ROBOTS: NonNullable<Metadata['robots']> = {
  index: false,
  follow: false,
}
