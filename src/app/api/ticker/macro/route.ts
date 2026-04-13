/**
 * GET /api/ticker/macro
 *
 * Returns macroeconomic indicator data for the economic ticker bar.
 * Upstream source: FRED (Federal Reserve Bank of St. Louis)
 *
 * Required environment variables:
 *   FRED_API_KEY — free key from https://fred.stlouisfed.org/docs/api/api_key.html
 *
 * Rate limits: FRED free tier allows ~1000+ requests/day — no concern here.
 * Cache: 24 hours (all macro series update monthly or less frequently).
 *
 * FRED series used:
 *   CPIAUCSL       — US CPI (All Urban Consumers, SA), units=pc1 → YoY %
 *   GBRCPIALLMINMEI — UK CPI (OECD), units=pc1 → YoY %
 *   UNRATE         — US Unemployment Rate (%)
 *   LRHUTTTTGBM156S — UK Unemployment Rate, 15-74, % (OECD)
 *   DFF            — US Effective Federal Funds Rate (%)
 *   BOEBR          — Bank of England Official Bank Rate (%)
 *   ECBDFR         — ECB Deposit Facility Rate (%)
 */

import { NextResponse } from 'next/server'

// force-dynamic prevents Next.js from statically pre-rendering this route at
// build time. A failed build-time pre-render causes Vercel to cache a 404 —
// the same issue that affected /api/publish-scheduled. Caching is replicated
// via Cache-Control on the response so Vercel's CDN caches it at the edge.
export const dynamic = 'force-dynamic'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY  = process.env.FRED_API_KEY

// ── Series configuration ───────────────────────────────────────────────────

interface SeriesConfig {
  label:    string
  seriesId: string
  unit:     'YOY' | '%'
  /** FRED units parameter — 'pc1' = percent change from year ago */
  fredUnits?: string
  fallback: number
}

const SERIES: SeriesConfig[] = [
  { label: 'US CPI',          seriesId: 'CPIAUCSL',         unit: 'YOY', fredUnits: 'pc1', fallback: 3.3  },
  { label: 'UK CPI',          seriesId: 'GBRCPIALLMINMEI',  unit: 'YOY', fredUnits: 'pc1', fallback: 3.0  },
  { label: 'US UNEMPLOYMENT', seriesId: 'UNRATE',           unit: '%',                     fallback: 4.3  },
  { label: 'UK UNEMPLOYMENT', seriesId: 'LRHUTTTTGBM156S',  unit: '%',                     fallback: 5.2  },
  { label: 'FEDERAL RESERVE', seriesId: 'DFF',              unit: '%',                     fallback: 3.75 },
  { label: 'BANK OF ENGLAND', seriesId: 'BOEBR',            unit: '%',                     fallback: 3.75 },
  { label: 'ECB RATE',        seriesId: 'ECBDFR',           unit: '%',                     fallback: 2.00 },
]

// ── FRED helper ────────────────────────────────────────────────────────────

async function fetchFredValue(cfg: SeriesConfig): Promise<number | null> {
  if (!FRED_KEY) return null
  try {
    const params = new URLSearchParams({
      series_id:  cfg.seriesId,
      api_key:    FRED_KEY,
      file_type:  'json',
      sort_order: 'desc',
      limit:      '1',
      ...(cfg.fredUnits ? { units: cfg.fredUnits } : {}),
    })
    const url = `${FRED_BASE}?${params}`
    const res = await fetch(url, {})
    if (!res.ok) {
      console.error(`[ticker/macro] FRED ${cfg.seriesId} HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    const obs = json?.observations?.[0]
    // FRED uses '.' to indicate a missing/not-yet-released observation
    if (!obs || obs.value === '.' || obs.value === null || obs.value === undefined) {
      console.error(`[ticker/macro] FRED ${cfg.seriesId} missing observation:`, JSON.stringify(json).slice(0, 120))
      return null
    }
    const parsed = parseFloat(obs.value)
    return isNaN(parsed) ? null : parsed
  } catch (err) {
    console.error(`[ticker/macro] FRED ${cfg.seriesId} error:`, err)
    return null
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET() {
  try {
    const results = await Promise.all(SERIES.map(fetchFredValue))

    const data = SERIES.map((cfg, i) => ({
      label:   cfg.label,
      value:   results[i] ?? cfg.fallback,
      unit:    cfg.unit,
    }))

    return NextResponse.json(
      { data, source: FRED_KEY ? 'fred' : 'fallback', updatedAt: new Date().toISOString() },
      {
        headers: {
          // Cache at Vercel edge for 24 hours (macro data updates monthly).
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800',
        },
      },
    )
  } catch (err) {
    // Never return an error to the frontend — fall back to hardcoded data
    console.error('[ticker/macro] Unhandled error, returning fallback:', err)
    return NextResponse.json(
      {
        data:      SERIES.map((cfg) => ({ label: cfg.label, value: cfg.fallback, unit: cfg.unit })),
        source:    'fallback',
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    )
  }
}
