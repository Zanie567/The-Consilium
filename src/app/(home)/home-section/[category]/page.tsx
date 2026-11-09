import { ALL_VIEW_SEGMENT, HomeView, homeMetadata } from '@/components/home/HomeView'
import { normaliseSearchText } from '@/lib/searchText'

// The homepage. next.config.ts rewrites / here as `_` (the "All" view) and each category tab,
// /?category=<slug>, as its slug, so the visitor's URL is unchanged. Served from the CDN (ISR):
// rendered on the first request for each view, cached for PUBLIC_PAGE_REVALIDATE_SECONDS (literal
// below) and expired at once by revalidateArticleLists() whenever anything public changes. Every view
// has the homepage's metadata (canonical /), as the tabs always had. An unknown slug renders the
// section-shaped empty state, as before, and is cached like any other view.
// This route must not read searchParams, the session or cookies (see HomeView).
// Pinned by tests/unit/public-page-caching.test.ts.
export const revalidate = 3600
export function generateStaticParams() {
  return []
}

export const metadata = homeMetadata

export default async function HomePage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params
  const categorySlug = category === ALL_VIEW_SEGMENT ? undefined : normaliseSearchText(category, 200)
  return <HomeView categorySlug={categorySlug} />
}
