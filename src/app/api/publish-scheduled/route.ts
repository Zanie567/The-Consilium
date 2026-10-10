/**
 * POST /api/publish-scheduled
 *
 * Finds all articles with status=SCHEDULED whose scheduledAt has passed and
 * publishes them. Called every 5 minutes by a scheduler outside Vercel (the
 * Hobby plan cannot run a 5-minute cron): currently the GitHub Actions workflow
 * .github/workflows/publish-scheduled.yml; Supabase Cron + pg_net is prepared to
 * replace it (docs/scheduler-supabase-cron.md). Either way the contract is the same.
 *
 * Authentication: `Authorization: Bearer <secret>` (or `x-cron-secret`), checked in
 * constant time by verifyPublishCronAuth before anything else runs. The secret must be
 * PUBLISH_CRON_SECRET (a secret that can publish and nothing else; what Supabase Cron
 * sends) or CRON_SECRET (what GitHub Actions sends). No other route accepts
 * PUBLISH_CRON_SECRET, so it cannot purge trash or run any other job.
 *
 * Response (always JSON): { ranAt, due, published, articles, skipped, warnings }.
 * A 2xx answer MUST keep numeric `due` and `published`: the Supabase reconciler treats a
 * 2xx body without them as `bad_response` (the publisher did not run), so renaming
 * either field would make every run look like a failure.
 *
 * Secrets (each pair must hold the same value):
 *   GitHub Actions    CRON_SECRET (= Vercel CRON_SECRET), and SITE_URL = the canonical host
 *                     https://www.theconsilium.co.uk (no trailing slash)
 *   Supabase Cron     Vault `publish_cron_secret` (= Vercel PUBLISH_CRON_SECRET), only once
 *                     Supabase Cron is activated
 */

import { NextResponse } from 'next/server'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { verifyPublishCronAuth } from '@/lib/cronAuth'

// Force dynamic so Next.js never pre-renders or caches this route.
// Without this, Vercel's edge may serve a stale 404 if the route was absent
// in an earlier (broken) deployment.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  // Constant-time check against PUBLISH_CRON_SECRET (Supabase Cron) or CRON_SECRET (GitHub Actions).
  // Unlike every other cron route this one accepts the publish-only secret, and no other route does.
  const authError = verifyPublishCronAuth(req, 'publish-scheduled')
  if (authError) return authError

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
