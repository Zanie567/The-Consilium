import type { Metadata } from 'next'
import { NOINDEX_ROBOTS } from '@/lib/seo'

// The search page itself is a client component and so cannot export metadata.
// This layout carries it instead.
//
// Search result URLs are unbounded crawl space and the page renders no server
// HTML to index, so it stays out of the index while remaining crawlable for the
// links in the surrounding chrome.
export const metadata: Metadata = {
  title: 'Search',
  robots: NOINDEX_ROBOTS,
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children
}
