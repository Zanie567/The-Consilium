import { getISOWeek, getISOWeekYear, startOfISOWeek } from 'date-fns'
import { prisma } from '@/lib/prisma'

/**
 * Writer streaks.
 *
 * A writer earns one unit of streak for each consecutive ISO calendar week
 * (Monday to Sunday) in which they have at least one PUBLISHED article whose
 * publishedAt falls in that week.
 *
 * Timezone note: the recalculation cron runs on Vercel and GitHub Actions, both
 * of which use UTC, so date-fns week boundaries are UTC "Monday to Sunday" as the
 * spec requires. Adjacency is checked via the millisecond gap between each week's
 * Monday (startOfISOWeek), which stays correct across year boundaries where 52-
 * and 53-week years make raw week-number arithmetic unreliable.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whether two ISO-week Monday timestamps are exactly one week apart. The gap is
 * rounded to whole days so a daylight-saving transition falling between the two
 * Mondays (which makes the gap 7 days plus or minus 1 hour in a non-UTC runtime)
 * is still counted as adjacent. In the UTC cron runtime the gap is exactly 7 days.
 */
function isOneWeekApart(earlierMs: number, laterMs: number): boolean {
  return Math.round((laterMs - earlierMs) / MS_PER_DAY) === 7
}

/**
 * Recomputes and upserts the WriterStreak row for a single user.
 *
 * Never throws: a failure for one writer is logged and swallowed so a batch job
 * iterating many writers is not blocked by a single bad record.
 */
export async function recalculateStreakForUser(userId: string): Promise<void> {
  try {
    const articles = await prisma.article.findMany({
      where: {
        authorId: userId,
        status: 'PUBLISHED',
        deletedAt: null,
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: 'asc' },
      select: { publishedAt: true },
    })

    // publishedAt is nullable in the schema; filter defensively even though the
    // query already excludes nulls, so the types narrow to Date.
    const dates = articles
      .map((a) => a.publishedAt)
      .filter((d): d is Date => d !== null)

    if (dates.length === 0) {
      await upsertStreak(userId, { currentStreak: 0, longestStreak: 0, lastPublishedAt: null })
      return
    }

    // Group publications by ISO week. The (isoWeekYear, isoWeek) pair uniquely
    // identifies a week; the Monday timestamp is kept for adjacency checks.
    const weekToMonday = new Map<string, number>()
    for (const d of dates) {
      const key = `${getISOWeekYear(d)}-${getISOWeek(d)}`
      if (!weekToMonday.has(key)) {
        weekToMonday.set(key, startOfISOWeek(d).getTime())
      }
    }

    const weekStarts = Array.from(weekToMonday.values()).sort((a, b) => a - b)

    // Longest run of consecutive weeks anywhere in the history.
    let longestStreak = 1
    let run = 1
    for (let i = 1; i < weekStarts.length; i++) {
      if (isOneWeekApart(weekStarts[i - 1], weekStarts[i])) {
        run += 1
      } else {
        run = 1
      }
      if (run > longestStreak) longestStreak = run
    }

    // Current streak: consecutive weeks counting back from the most recent
    // publication week (per spec). This is anchored to the latest publication,
    // not to "today", so the daily cron does not silently reset a streak just
    // because the current week has no publication yet.
    let currentStreak = 1
    for (let i = weekStarts.length - 1; i > 0; i--) {
      if (isOneWeekApart(weekStarts[i - 1], weekStarts[i])) {
        currentStreak += 1
      } else {
        break
      }
    }

    const lastPublishedAt = dates.reduce((latest, d) => (d > latest ? d : latest), dates[0])

    await upsertStreak(userId, { currentStreak, longestStreak, lastPublishedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[streaks] Failed to recalculate streak for user ${userId}: ${message}`)
    // Intentionally swallowed: do not block a batch job on one writer's failure.
  }
}

async function upsertStreak(
  userId: string,
  data: { currentStreak: number; longestStreak: number; lastPublishedAt: Date | null }
): Promise<void> {
  await prisma.writerStreak.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
}
