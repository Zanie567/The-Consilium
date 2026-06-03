/**
 * POST /api/cron/update-engagement-scores
 *
 * Recomputes and stores the engagement score for every PUBLISHED article.
 * Triggered daily by a GitHub Actions workflow.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET>.
 *
 * GitHub Actions secret required: CRON_SECRET
 * Vercel env var required:        CRON_SECRET (same value)
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeEngagementScore } from '@/lib/gamification/engagement'
import { verifyCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
// Bound the function (Vercel Hobby caps execution at 60s). The publication's
// article count is small enough to score sequentially within this budget; if it
// ever grows large enough to approach the limit, switch to cursor-based batching.
export const maxDuration = 60

export async function POST(req: Request) {
  const authError = verifyCronAuth(req, 'update-engagement-scores')
  if (authError) return authError

  try {
    const articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { id: true },
    })

    const ranAt = new Date().toISOString()
    let processed = 0
    let errors = 0

    // Sequential (not Promise.all) so the score computation does not hammer the
    // database with concurrent aggregate queries.
    for (const { id } of articles) {
      try {
        const score = await computeEngagementScore(id)
        await prisma.article.update({ where: { id }, data: { engagementScore: score } })
        processed += 1
      } catch (err) {
        errors += 1
        console.error(
          `[update-engagement-scores] Failed for article ${id}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    return NextResponse.json({ ranAt, processed, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[update-engagement-scores] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
