import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/constants'
import { SHARE_IMAGE } from '@/lib/brand'

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

/** An image a page offers for its share card. Dimensions are optional for editor-supplied covers. */
export interface ShareImage {
  url: string
  width?: number
  height?: number
  type?: string
  alt: string
}

/** The site's fallback share image, used whenever a page has nothing better. */
export const DEFAULT_SHARE_IMAGE: ShareImage = { ...SHARE_IMAGE }

/**
 * The share images for an article: its cover image when it has one (the
 * editor's choice always wins), otherwise the site's default card.
 */
export function articleShareImages(coverImage: string | null | undefined, title: string): ShareImage[] {
  return coverImage ? [{ url: coverImage, alt: title }] : [DEFAULT_SHARE_IMAGE]
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
  overrides: {
    title?: string
    description?: string
    /** A page-specific share image; defaults to the site's share card. */
    image?: ShareImage
  } = {}
): Metadata['openGraph'] {
  return {
    title: overrides.title ?? SITE_NAME,
    description: overrides.description ?? SITE_DESCRIPTION,
    type: 'website',
    locale: 'en_GB',
    url: path.startsWith('/') ? path : `/${path}`,
    siteName: SITE_NAME,
    images: [overrides.image ?? DEFAULT_SHARE_IMAGE],
  }
}

/**
 * Build a complete `twitter` object for a page.
 *
 * Same reasoning as pageOpenGraph: a page that sets `twitter` at all replaces
 * the root's object, and one written without `images` falls back to whatever
 * the openGraph happens to hold. This always names the card type and image.
 */
export function pageTwitter(
  overrides: { title?: string; description?: string; images?: ShareImage[] } = {}
): Metadata['twitter'] {
  return {
    card: 'summary_large_image',
    title: overrides.title ?? SITE_NAME,
    description: overrides.description ?? SITE_DESCRIPTION,
    images: (overrides.images ?? [DEFAULT_SHARE_IMAGE]).map(({ url, alt }) => ({ url, alt })),
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
