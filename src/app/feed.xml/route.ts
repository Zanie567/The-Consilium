import { buildFeedXml, FRESH_XML_CACHE_CONTROL, getCachedFeedItems } from '@/lib/publicFeeds'

const SITE_URL = 'https://theconsilium.co.uk'
const CHANNEL_DESCRIPTION =
  'Economics analysis, opinion, and research from the University of Edinburgh'

// Dynamic on purpose: the response must never be a cached copy that a content change cannot reach.
// Freshness comes from the tagged data cache in publicFeeds.ts, which every visibility change expires.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const xml = buildFeedXml(await getCachedFeedItems(), { siteUrl: SITE_URL, description: CHANNEL_DESCRIPTION })
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': FRESH_XML_CACHE_CONTROL },
    })
  } catch (error) {
    console.error('Failed to generate RSS feed', error)
    return new Response('Failed to generate RSS feed', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}
