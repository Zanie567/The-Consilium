/**
 * GET /api/ticker/markets
 *
 * Delayed quotes for the homepage ticker, from the Yahoo Finance chart
 * endpoint (see src/lib/marketData.ts). No credentials are involved.
 *
 * Only quotes that arrived intact and are within MARKET_MAX_AGE_MS are
 * returned. An instrument that fails or goes stale is omitted, never replaced
 * with a placeholder number, so nothing here can present old data as current.
 */

import { NextResponse } from 'next/server'
import { fetchMarketQuotes } from '@/lib/marketData'

export const dynamic = 'force-dynamic'

export async function GET() {
  const quotes = await fetchMarketQuotes()
  return NextResponse.json(
    { quotes, fetchedAt: new Date().toISOString() },
    {
      headers: {
        // 15 minutes matches the exchange delay on the index quotes; serving
        // stale for an hour while revalidating keeps upstream load flat.
        'Cache-Control': quotes.length
          ? 'public, s-maxage=900, stale-while-revalidate=3600'
          // Nothing usable: retry soon rather than caching an empty ticker.
          : 'public, s-maxage=60, stale-while-revalidate=120',
      },
    },
  )
}
