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

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[update-engagement-scores] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { id: true },
    })

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

    return NextResponse.json({ processed, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[update-engagement-scores] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
