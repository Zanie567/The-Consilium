/**
 * POST /api/cron/recalculate-streaks
 *
 * Recomputes the writer-streak record for every author with at least one
 * PUBLISHED article. Triggered daily by a GitHub Actions workflow.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET>.
 *
 * GitHub Actions secret required: CRON_SECRET
 * Vercel env var required:        CRON_SECRET (same value)
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recalculateStreakForUser } from '@/lib/gamification/streaks'

export const dynamic = 'force-dynamic'
// Bound the function (Vercel Hobby caps execution at 60s).
export const maxDuration = 60

/** Constant-time secret comparison so the auth check does not leak via timing. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[recalculate-streaks] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''
  if (!provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const authors = await prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { not: null } },
      select: { authorId: true },
      distinct: ['authorId'],
    })

    let processed = 0
    let errors = 0

    // Sequential (not Promise.all) so a large publication base does not hammer
    // the database with concurrent recalculations.
    for (const { authorId } of authors) {
      try {
        await recalculateStreakForUser(authorId)
        processed += 1
      } catch (err) {
        // recalculateStreakForUser already swallows its own errors; this guard
        // is defensive so one unexpected failure cannot abort the whole batch.
        errors += 1
        console.error(
          `[recalculate-streaks] Failed for user ${authorId}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    return NextResponse.json({ processed, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[recalculate-streaks] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
