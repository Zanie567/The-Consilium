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
import { prisma } from '@/lib/prisma'
import { sendEmail, articlePublishedEmail } from '@/lib/email'

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
    const now = new Date()

    // Find all articles whose scheduled publish time has arrived.
    const due = await prisma.article.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
        deletedAt: null,
      },
      include: { author: true },
    })

    if (due.length === 0) {
      // Normal - nothing to do right now.
      console.log('[publish-scheduled] No articles due for publishing')
      return NextResponse.json({ published: 0, articles: [] })
    }

    const publishedTitles: string[] = []

    for (const article of due) {
      // Update status to PUBLISHED and stamp publishedAt - same fields the
      // manual Publish button updates so behaviour is identical.
      await prisma.article.update({
        where: { id: article.id },
        data: { status: 'PUBLISHED', publishedAt: now },
      })

      // Send the author an email notification (non-fatal if email fails).
      if (article.author.email) {
        try {
          const { subject, html } = articlePublishedEmail(article.title, article.slug)
          await sendEmail({ to: article.author.email, subject, html })
        } catch (emailErr) {
          console.error(`[publish-scheduled] Email failed for article ${article.id}:`, emailErr)
        }
      }

      // Create an in-app notification for the author.
      await prisma.notification.create({
        data: {
          userId: article.authorId,
          type: 'published',
          title: 'Article published',
          message: `Your article "${article.title}" has been published.`,
          articleId: article.id,
        },
      })

      publishedTitles.push(article.title)
      console.log(`[publish-scheduled] Published: "${article.title}" (${article.id})`)
    }

    // Permanently purge articles soft-deleted more than 30 days ago
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const purged = await prisma.article.deleteMany({
      where: { deletedAt: { not: null, lte: thirtyDaysAgo } },
    })
    if (purged.count > 0) {
      console.log(`[publish-scheduled] Purged ${purged.count} article(s) from trash (>30 days old)`)
    }

    return NextResponse.json({ published: publishedTitles.length, articles: publishedTitles, purged: purged.count })
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
