/**
 * POST /api/publish-scheduled
 *
 * Finds all articles with status=SCHEDULED whose scheduledAt has passed and
 * publishes them. Called every 5 minutes by a GitHub Actions workflow - this
 * is the primary reliable publish trigger because Vercel Hobby plan does not
 * guarantee per-minute cron execution.
 *
 * Authentication: Bearer token in Authorization header, OR ?secret= query param.
 * The secret value must match the CRON_SECRET environment variable.
 *
 * GitHub Actions secrets required:
 *   CRON_SECRET  - long random string (min 32 chars), same value as Vercel env var
 *   SITE_URL     - production URL e.g. https://theconsilium.com (no trailing slash)
 *
 * Vercel environment variable required:
 *   CRON_SECRET  - exact same value as the GitHub Actions secret
 */

import { NextResponse } from 'next/server'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'

// Force dynamic so Next.js never pre-renders or caches this route.
// Without this, Vercel's edge may serve a stale 404 if the route was absent
// in an earlier (broken) deployment.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Misconfigured server - don't leak details, just refuse.
    console.error('[publish-scheduled] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  // Accept secret as Bearer token OR as ?secret= query param (for easy curl testing).
  const authHeader = req.headers.get('authorization') ?? ''
  const url = new URL(req.url)
  const querySecret = url.searchParams.get('secret') ?? ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : querySecret

  if (!provided || provided !== secret) {
    console.warn('[publish-scheduled] Unauthorized attempt - bad or missing secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Publish logic ──────────────────────────────────────────────────────────
  try {
    const published = await publishScheduledArticles()

    if (published.length === 0) {
      // Normal - nothing to do right now.
      console.log('[publish-scheduled] No articles due for publishing')
      return NextResponse.json({ published: 0, articles: [] })
    }

    return NextResponse.json({ published: published.length, ids: published })
  } catch (err) {
    // Surface the error in the response body so GitHub Actions logs show it.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[publish-scheduled] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Also accept GET so the Vercel cron (vercel.json) can keep hitting the same
// canonical URL without needing a second route file. Both methods share the
// same auth + logic.
export async function GET(req: Request) {
  return POST(req)
}
