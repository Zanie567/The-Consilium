/**
 * POST /api/publish-scheduled
 *
 * Finds all articles with status=SCHEDULED whose scheduledAt has passed and
 * publishes them. Called every 5 minutes by a GitHub Actions workflow - this
 * is the primary reliable publish trigger because Vercel Hobby plan does not
 * guarantee per-minute cron execution.
 *
 * Authentication: Bearer token in Authorization header only.
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

  const authHeader = req.headers.get('authorization') ?? ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''

  if (!provided || provided !== secret) {
    console.warn('[publish-scheduled] Unauthorized attempt - bad or missing secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await publishScheduledArticles()

    if (result.published.length === 0 && result.dueCount === 0) {
      console.warn('[publish-scheduled] No articles due for publishing')
      return NextResponse.json({
        ranAt: result.ranAt,
        due: 0,
        published: 0,
        articles: [],
        skipped: [],
        warnings: [],
      })
    }

    for (const article of result.published) {
      console.warn(`[publish-scheduled] Published: "${article.title}" (${article.id})`)
    }

    for (const warning of result.warnings) {
      console.error(
        `[publish-scheduled] ${warning.stage} warning for ${warning.articleId}: ${warning.message}`
      )
    }

    return NextResponse.json({
      ranAt: result.ranAt,
      due: result.dueCount,
      published: result.published.length,
      articles: result.published,
      skipped: result.skipped,
      warnings: result.warnings,
      purged: result.purged,
    })
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
