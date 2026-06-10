/**
 * GET /api/ticker/macro
 *
 * Returns macroeconomic indicator data for the economic ticker bar.
 * Upstream sources: FRED (Federal Reserve Bank of St. Louis), the
 * Bank of England Database (IADB) and the ONS website CSV generator.
 *
 * Required environment variables:
 *   FRED_API_KEY - free key from https://fred.stlouisfed.org/docs/api/api_key.html
 *   (the Bank of England and ONS endpoints need no key)
 *
 * Rate limits: FRED free tier allows ~1000+ requests/day - no concern here.
 * Cache: 24 hours (all macro series update monthly or less frequently).
 *
 * FRED series used:
 *   CPIAUCSL - US CPI (All Urban Consumers, SA), units=pc1 -> YoY %
 *   UNRATE   - US Unemployment Rate (%)
 *   DFF      - US Effective Federal Funds Rate (%)
 *   ECBDFR   - ECB Deposit Facility Rate (%)
 *
 * Bank of England IADB series used:
 *   IUDBEDR - Official Bank Rate (%), daily
 *   (FRED has no live BoE policy rate: BOERUKM/BOERUKQ/BOERUKA all ended in
 *   2016-2017, and the previously configured id BOEBR never existed - FRED
 *   returned 400 and the slot silently served its hardcoded fallback.)
 *
 * ONS series used:
 *   D7G7 (dataset MM23) - UK CPI annual rate, YoY %
 *   MGSX (dataset LMS)  - UK Unemployment Rate, 16+, %
 *   (FRED's OECD-sourced UK series GBRCPIALLMINMEI and LRHUTTTTGBM156S
 *   stopped updating in 2025, so the slots silently served stale values.
 *   The old api.ons.gov.uk timeseries API was decommissioned 25 Nov 2024;
 *   the www.ons.gov.uk CSV generator is the keyless replacement.)
 */

import { NextResponse } from 'next/server'

// force-dynamic prevents Next.js from statically pre-rendering this route at
// build time. A failed build-time pre-render causes Vercel to cache a 404 -
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
  /** Upstream API the seriesId belongs to (default 'fred') */
  source?:  'fred' | 'boe' | 'ons'
  /** FRED units parameter - 'pc1' = percent change from year ago */
  fredUnits?: string
  /** ONS website uri for the series, e.g. /economy/.../timeseries/d7g7/mm23 */
  onsUri?: string
  fallback: number
}

const SERIES: SeriesConfig[] = [
  { label: 'US CPI',          seriesId: 'CPIAUCSL', unit: 'YOY', fredUnits: 'pc1', fallback: 3.8  },
  { label: 'UK CPI',          seriesId: 'D7G7',     unit: 'YOY', source: 'ons',    fallback: 2.8,
    onsUri: '/economy/inflationandpriceindices/timeseries/d7g7/mm23' },
  { label: 'US UNEMPLOYMENT', seriesId: 'UNRATE',   unit: '%',                     fallback: 4.3  },
  { label: 'UK UNEMPLOYMENT', seriesId: 'MGSX',     unit: '%',   source: 'ons',    fallback: 5.0,
    onsUri: '/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms' },
  { label: 'FEDERAL RESERVE', seriesId: 'DFF',      unit: '%',                     fallback: 3.6  },
  { label: 'BANK OF ENGLAND', seriesId: 'IUDBEDR',  unit: '%',   source: 'boe',    fallback: 3.75 },
  { label: 'ECB RATE',        seriesId: 'ECBDFR',   unit: '%',                     fallback: 2.00 },
]

// ── FRED helper ────────────────────────────────────────────────────────────

interface FredResult {
  value: number
  previousValue: number | null
}

async function fetchFredValue(cfg: SeriesConfig): Promise<FredResult | null> {
  if (!FRED_KEY) return null
  try {
    const params = new URLSearchParams({
      series_id:  cfg.seriesId,
      api_key:    FRED_KEY,
      file_type:  'json',
      sort_order: 'desc',
      limit:      '2',   // fetch two so we can compute direction
      ...(cfg.fredUnits ? { units: cfg.fredUnits } : {}),
    })
    const url = `${FRED_BASE}?${params}`
    const res = await fetch(url, {})
    if (!res.ok) {
      // Include the body: FRED's 400 "The series does not exist" is a config
      // bug, not a transient failure, and must be distinguishable in logs.
      const body = await res.text().catch(() => '')
      console.error(`[ticker/macro] FRED ${cfg.seriesId} HTTP ${res.status}: ${body.slice(0, 200)}`)
      return null
    }
    const json = await res.json()
    const obs = json?.observations ?? []
    const latest  = obs[0]
    const prev    = obs[1]
    if (!latest || latest.value === '.' || latest.value == null) {
      console.error(`[ticker/macro] FRED ${cfg.seriesId} missing observation:`, JSON.stringify(json).slice(0, 120))
      return null
    }
    const value = parseFloat(latest.value)
    if (isNaN(value)) return null
    const previousValue = prev && prev.value !== '.' && prev.value != null
      ? parseFloat(prev.value)
      : null
    return { value, previousValue: isNaN(previousValue ?? NaN) ? null : previousValue }
  } catch (err) {
    console.error(`[ticker/macro] FRED ${cfg.seriesId} error:`, err)
    return null
  }
}

// ── Bank of England helper ─────────────────────────────────────────────────

const BOE_BASE = 'https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp'
const BOE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Fetches the latest two observations of a Bank of England IADB series as
 * CSV (DATE,<code> header, ascending daily rows). No API key required.
 */
async function fetchBoeValue(cfg: SeriesConfig): Promise<FredResult | null> {
  try {
    // 60 days back guarantees multiple business-day observations.
    const from = new Date(Date.now() - 60 * 86400_000)
    const params = new URLSearchParams({
      'csv.x':     'yes',
      Datefrom:    `${String(from.getUTCDate()).padStart(2, '0')}/${BOE_MONTHS[from.getUTCMonth()]}/${from.getUTCFullYear()}`,
      Dateto:      'now',
      SeriesCodes: cfg.seriesId,
      CSVF:        'TN',
      UsingCodes:  'Y',
      VPD:         'Y',
      VFD:         'N',
    })
    const res = await fetch(`${BOE_BASE}?${params}`)
    if (!res.ok) {
      console.error(`[ticker/macro] BoE ${cfg.seriesId} HTTP ${res.status}`)
      return null
    }
    const csv = await res.text()
    const rows = csv.trim().split('\n').slice(1)        // drop "DATE,IUDBEDR" header
    const values = rows
      .map((row) => parseFloat(row.split(',')[1]))
      .filter((v) => !isNaN(v))
    if (values.length === 0) {
      console.error(`[ticker/macro] BoE ${cfg.seriesId} no parseable rows:`, csv.slice(0, 120))
      return null
    }
    return {
      value:         values[values.length - 1],
      previousValue: values.length > 1 ? values[values.length - 2] : null,
    }
  } catch (err) {
    console.error(`[ticker/macro] BoE ${cfg.seriesId} error:`, err)
    return null
  }
}

// ── ONS helper ─────────────────────────────────────────────────────────────

const ONS_BASE = 'https://www.ons.gov.uk/generator?format=csv&uri='

/**
 * Fetches the latest two monthly observations of an ONS time series via the
 * www.ons.gov.uk CSV generator. No API key required. The CSV starts with
 * metadata rows, then annual ("1989","5.2"), quarterly ("1994 Q2","2.0") and
 * finally monthly ("2026 APR","2.8") observations - only monthly rows are
 * used.
 */
async function fetchOnsValue(cfg: SeriesConfig): Promise<FredResult | null> {
  if (!cfg.onsUri) return null
  try {
    const res = await fetch(`${ONS_BASE}${cfg.onsUri}`)
    if (!res.ok) {
      console.error(`[ticker/macro] ONS ${cfg.seriesId} HTTP ${res.status}`)
      return null
    }
    const csv = await res.text()
    const values = csv
      .split('\n')
      .filter((row) => /^"\d{4} [A-Z]{3}",/.test(row))
      .map((row) => parseFloat(row.split(',')[1]?.replace(/"/g, '')))
      .filter((v) => !isNaN(v))
    if (values.length === 0) {
      console.error(`[ticker/macro] ONS ${cfg.seriesId} no monthly rows:`, csv.slice(0, 120))
      return null
    }
    return {
      value:         values[values.length - 1],
      previousValue: values.length > 1 ? values[values.length - 2] : null,
    }
  } catch (err) {
    console.error(`[ticker/macro] ONS ${cfg.seriesId} error:`, err)
    return null
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

function fetchSeriesValue(cfg: SeriesConfig): Promise<FredResult | null> {
  switch (cfg.source) {
    case 'boe': return fetchBoeValue(cfg)
    case 'ons': return fetchOnsValue(cfg)
    default:    return fetchFredValue(cfg)
  }
}

export async function GET() {
  try {
    const results = await Promise.all(SERIES.map(fetchSeriesValue))

    const data = SERIES.map((cfg, i) => {
      const res = results[i]
      return {
        label:         cfg.label,
        value:         res?.value         ?? cfg.fallback,
        previousValue: res?.previousValue ?? null,
        unit:          cfg.unit,
      }
    })

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
    // Never return an error to the frontend - fall back to hardcoded data
    console.error('[ticker/macro] Unhandled error, returning fallback:', err)
    return NextResponse.json(
      {
        data:      SERIES.map((cfg) => ({ label: cfg.label, value: cfg.fallback, previousValue: null, unit: cfg.unit })),
        source:    'fallback',
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    )
  }
}
