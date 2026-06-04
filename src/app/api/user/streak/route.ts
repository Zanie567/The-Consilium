import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { STREAK_INTERVAL_WEEKS } from '@/lib/constants'
import { recalculateStreakForUser } from '@/lib/gamification/streaks'

export const dynamic = 'force-dynamic'

/** GET /api/user/streak: the current user's writer streak, or a zero-state. */
export async function GET() {
  const user = await getVerifiedSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const streak = await prisma.writerStreak.findUnique({
      where: { userId: user.id },
    })

    return NextResponse.json({
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      lastPublishedAt: streak?.lastPublishedAt?.toISOString() ?? null,
      intervalWeeks: streak?.intervalWeeks ?? STREAK_INTERVAL_WEEKS.DEFAULT,
    })
  } catch (err) {
    console.error('[user/streak] Error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/user/streak: set the current user's streak cadence (intervalWeeks).
 * The streak is recomputed under the new cadence before returning so the caller
 * sees the updated figures immediately.
 */
export async function PATCH(req: Request) {
  const user = await getVerifiedSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let intervalWeeks: number
  try {
    const body = (await req.json()) as { intervalWeeks: unknown }
    const raw = body.intervalWeeks
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      return NextResponse.json({ error: 'intervalWeeks must be an integer' }, { status: 400 })
    }
    if (raw < STREAK_INTERVAL_WEEKS.MIN || raw > STREAK_INTERVAL_WEEKS.MAX) {
      return NextResponse.json(
        {
          error: `intervalWeeks must be between ${STREAK_INTERVAL_WEEKS.MIN} and ${STREAK_INTERVAL_WEEKS.MAX}.`,
        },
        { status: 400 }
      )
    }
    intervalWeeks = raw
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const userId = user.id

    // Persist the cadence (select: { id } avoids the missing-column failure mode
    // on the RETURNING clause if the streak row is created here).
    await prisma.writerStreak.upsert({
      where: { userId },
      create: { userId, intervalWeeks },
      update: { intervalWeeks },
      select: { id: true },
    })

    // Recompute current/longest under the new cadence so the dashboard updates.
    await recalculateStreakForUser(userId)

    const streak = await prisma.writerStreak.findUnique({ where: { userId } })
    return NextResponse.json({
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      lastPublishedAt: streak?.lastPublishedAt?.toISOString() ?? null,
      intervalWeeks: streak?.intervalWeeks ?? intervalWeeks,
    })
  } catch (err) {
    console.error('[user/streak] PATCH error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
