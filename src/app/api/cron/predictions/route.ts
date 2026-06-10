/**
 * POST /api/cron/predictions
 *
 * Auto-scores prediction events from FRED. Finds unresolved events past their
 * expected release date that have a fredSeriesId, fetches the latest
 * observation for that series, and resolves the event only when the
 * observation is dated on or after the expected release date. Events whose
 * data has not landed yet are left for the next run.
 *
 * Idempotent: resolution claims the event row with a conditional update inside
 * a transaction (see src/lib/predictionResolve.ts), so running this twice, or
 * concurrently with a manual resolve, can never double-score.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET>.
 *
 * GitHub Actions secret required: CRON_SECRET
 * Vercel env var required:        CRON_SECRET (same value)
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyCronAuth } from '@/lib/cronAuth'
import { resolvePredictionEvent } from '@/lib/predictionResolve'

export const dynamic = 'force-dynamic'
// Bound the function (Vercel Hobby caps execution at 60s).
export const maxDuration = 60

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

interface FredObservation {
  /** Observation date, YYYY-MM-DD. */
  date: string
  value: number
}

/**
 * Fetches the latest observation for a FRED series, mirroring the fetch style
 * of src/app/api/ticker/macro/route.ts. CPI year on year events ask FRED for
 * units=pc1 (percent change from a year ago) since the raw series is an index.
 */
async function fetchLatestObservation(
  seriesId: string,
  eventType: string
): Promise<FredObservation | null> {
  if (!FRED_KEY) return null
  try {
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: FRED_KEY,
      file_type: 'json',
      sort_order: 'desc',
      limit: '1',
      ...(eventType === 'CPI_YOY' ? { units: 'pc1' } : {}),
    })
    const res = await fetch(`${FRED_BASE}?${params}`, {})
    if (!res.ok) {
      console.error(`[cron/predictions] FRED ${seriesId} HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    const latest = json?.observations?.[0]
    if (!latest || latest.value === '.' || latest.value == null) {
      console.error(
        `[cron/predictions] FRED ${seriesId} missing observation:`,
        JSON.stringify(json).slice(0, 120)
      )
      return null
    }
    const value = parseFloat(latest.value)
    if (isNaN(value) || typeof latest.date !== 'string') return null
    return { date: latest.date, value }
  } catch (err) {
    console.error(`[cron/predictions] FRED ${seriesId} error:`, err)
    return null
  }
}

export async function POST(req: Request) {
  const authError = verifyCronAuth(req, 'cron/predictions')
  if (authError) return authError

  // Declared before the try so the catch returns the same { ranAt, ... } contract.
  const ranAt = new Date().toISOString()

  try {
    const due = await prisma.predictionEvent.findMany({
      where: {
        status: { in: ['OPEN', 'CLOSED'] },
        resolvedAt: null,
        fredSeriesId: { not: null },
        releaseDate: { lte: new Date() },
      },
      select: { id: true, title: true, type: true, fredSeriesId: true, releaseDate: true },
      orderBy: { releaseDate: 'asc' },
    })

    const resolvedEvents: Array<{ id: string; title: string; actualValue: number; scored: number }> = []
    let waiting = 0
    let errors = 0

    // Sequential (not Promise.all) so a backlog of events does not hammer FRED
    // or the database with concurrent resolutions.
    for (const event of due) {
      try {
        const obs = await fetchLatestObservation(event.fredSeriesId!, event.type)
        if (!obs) {
          errors += 1
          continue
        }
        // FRED observation dates are calendar dates (YYYY-MM-DD). Only resolve
        // once the observation covers the expected release; an older
        // observation means the new figure has not landed in FRED yet.
        const releaseDay = event.releaseDate.toISOString().slice(0, 10)
        if (obs.date < releaseDay) {
          waiting += 1
          continue
        }
        const outcome = await resolvePredictionEvent(event.id, obs.value)
        if (outcome.resolved) {
          resolvedEvents.push({
            id: event.id,
            title: event.title,
            actualValue: obs.value,
            scored: outcome.scored,
          })
        }
      } catch (err) {
        errors += 1
        console.error(
          `[cron/predictions] Failed for event ${event.id}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    return NextResponse.json({
      ranAt,
      due: due.length,
      resolved: resolvedEvents.length,
      resolvedEvents,
      waiting,
      errors,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/predictions] Error:', message)
    return NextResponse.json({ ranAt, error: message }, { status: 500 })
  }
}
