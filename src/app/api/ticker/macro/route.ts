/**
 * GET /api/ticker/macro
 *
 * Latest published macroeconomic observations for the homepage ticker.
 * Series definitions, parsing and freshness rules live in src/lib/macroData.ts.
 *
 * Sources: FRED (FRED_API_KEY, read server-side only and never sent to the
 * client), the Bank of England IADB and the ONS CSV generator.
 *
 * A series that fails or falls outside its release cadence is omitted rather
 * than replaced with a placeholder, so a discontinued series disappears
 * instead of freezing at an old reading - the failure that previously left
 * retired FRED UK series on display for a year.
 */

import { NextResponse } from 'next/server'
import {
  MACRO_SERIES,
  isObservationFresh,
  parseBoeCsv,
  parseFredObservations,
  parseOnsCsv,
  type MacroObservation,
  type SeriesConfig,
  type SeriesReading,
} from '@/lib/macroData'

export const dynamic = 'force-dynamic'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const BOE_BASE = 'https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp'
const ONS_BASE = 'https://www.ons.gov.uk/generator?format=csv&uri='
const BOE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const REQUEST_TIMEOUT_MS = 6000

async function get(url: string, label: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) {
      console.error(`[ticker/macro] ${label}: HTTP ${res.status}`)
      return null
    }
    return res
  } catch (err) {
    console.error(`[ticker/macro] ${label}: ${err instanceof Error ? err.message : 'request failed'}`)
    return null
  }
}

async function readSeries(cfg: SeriesConfig): Promise<SeriesReading | null> {
  if (cfg.source === 'fred') {
    const key = process.env.FRED_API_KEY
    if (!key) {
      console.error(`[ticker/macro] ${cfg.seriesId}: FRED_API_KEY is not set`)
      return null
    }
    const params = new URLSearchParams({
      series_id: cfg.seriesId,
      api_key: key,
      file_type: 'json',
      sort_order: 'desc',
      limit: '2',
      ...(cfg.fredUnits ? { units: cfg.fredUnits } : {}),
    })
    const res = await get(`${FRED_BASE}?${params}`, cfg.seriesId)
    return res ? parseFredObservations(await res.json()) : null
  }

  if (cfg.source === 'boe') {
    const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const params = new URLSearchParams({
      'csv.x': 'yes',
      Datefrom: `${String(from.getUTCDate()).padStart(2, '0')}/${BOE_MONTHS[from.getUTCMonth()]}/${from.getUTCFullYear()}`,
      Dateto: 'now',
      SeriesCodes: cfg.seriesId,
      CSVF: 'TN',
      UsingCodes: 'Y',
      VPD: 'Y',
      VFD: 'N',
    })
    const res = await get(`${BOE_BASE}?${params}`, cfg.seriesId)
    return res ? parseBoeCsv(await res.text()) : null
  }

  if (!cfg.onsUri) return null
  const res = await get(`${ONS_BASE}${cfg.onsUri}`, cfg.seriesId)
  return res ? parseOnsCsv(await res.text()) : null
}

export async function GET() {
  const readings = await Promise.all(MACRO_SERIES.map(readSeries))

  const observations: MacroObservation[] = []
  MACRO_SERIES.forEach((cfg, i) => {
    const reading = readings[i]
    if (!reading) return
    if (!isObservationFresh(reading.observationDate, cfg.cadence)) {
      console.error(`[ticker/macro] ${cfg.seriesId}: dropping ${cfg.cadence} observation from ${reading.observationDate}`)
      return
    }
    observations.push({
      label: cfg.label,
      value: reading.value,
      previousValue: reading.previousValue,
      unit: cfg.unit,
      observationDate: reading.observationDate,
    })
  })

  return NextResponse.json(
    { observations, fetchedAt: new Date().toISOString() },
    {
      headers: {
        // Nothing here changes more than once a day.
        'Cache-Control': observations.length
          ? 'public, s-maxage=21600, stale-while-revalidate=86400'
          : 'public, s-maxage=300, stale-while-revalidate=600',
      },
    },
  )
}
