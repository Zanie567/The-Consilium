import { getISOWeek, getISOWeekYear, startOfISOWeek } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { STREAK_INTERVAL_WEEKS } from '@/lib/constants'

/**
 * Writer streaks.
 *
 * A writer extends their streak with each publication that lands within their
 * chosen cadence of the previous one. The cadence (writer_streaks.intervalWeeks,
 * default 1) is the maximum number of ISO weeks allowed between two consecutive
 * publication weeks before the streak breaks, so a fortnightly writer can set 2
 * and keep their streak. At the default of 1 this is exactly the original "every
 * consecutive ISO week" behaviour.
 *
 * Timezone note: the recalculation cron runs on Vercel and GitHub Actions, both of
 * which use UTC, so date-fns week boundaries are UTC "Monday to Sunday". Adjacency
 * is checked via the gap between each week's Monday (startOfISOWeek) rounded to
 * whole weeks, which stays correct across 52/53-week year boundaries and across
 * daylight-saving transitions in non-UTC runtimes.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * Whether two ISO-week Monday timestamps are within the writer's cadence: at least
 * one and at most `intervalWeeks` weeks apart. The gap is rounded to whole weeks so
 * a daylight-saving transition between the two Mondays (which makes the gap N weeks
 * plus or minus an hour in a non-UTC runtime) is still counted correctly. Distinct
 * publication weeks are always at least one week apart.
 */
function isWithinCadence(earlierMs: number, laterMs: number, intervalWeeks: number): boolean {
  const weeks = Math.round((laterMs - earlierMs) / MS_PER_WEEK)
  return weeks >= 1 && weeks <= intervalWeeks
}

/**
 * Returns true if the streak deadline has not yet passed: the current ISO week
 * is at most `intervalWeeks` ahead of the last publication's ISO week. Used by
 * both the recalculation logic and the dashboard's live display.
 */
export function isStreakStillActive(lastPublishedAt: Date, intervalWeeks: number): boolean {
  const nowMonday = startOfISOWeek(new Date()).getTime()
  const lastPubMonday = startOfISOWeek(lastPublishedAt).getTime()
  const weeksSinceLastPub = Math.round((nowMonday - lastPubMonday) / MS_PER_WEEK)
  return weeksSinceLastPub <= intervalWeeks
}

/**
 * Reads the writer's configured streak cadence, defaulting to weekly. Guarded so a
 * missing intervalWeeks column (before its ALTER TABLE is applied) degrades to
 * weekly rather than aborting the whole recalculation.
 */
async function readIntervalWeeks(userId: string): Promise<number> {
  try {
    const streak = await prisma.writerStreak.findUnique({
      where: { userId },
      select: { intervalWeeks: true },
    })
    return streak?.intervalWeeks ?? STREAK_INTERVAL_WEEKS.DEFAULT
  } catch {
    return STREAK_INTERVAL_WEEKS.DEFAULT
  }
}

/**
 * Recomputes and upserts the WriterStreak row for a single user.
 *
 * Never throws: a failure for one writer is logged and swallowed so a batch job
 * iterating many writers is not blocked by a single bad record. The writer's
 * intervalWeeks cadence is preserved (the upsert never writes that column).
 */
export async function recalculateStreakForUser(userId: string): Promise<void> {
  try {
    const intervalWeeks = await readIntervalWeeks(userId)

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

    // Longest run of cadence-adjacent weeks anywhere in the history.
    let longestStreak = 1
    let run = 1
    for (let i = 1; i < weekStarts.length; i++) {
      if (isWithinCadence(weekStarts[i - 1], weekStarts[i], intervalWeeks)) {
        run += 1
      } else {
        run = 1
      }
      if (run > longestStreak) longestStreak = run
    }

    // Current streak: cadence-adjacent weeks counting back from the most recent
    // publication week. Anchored to the latest publication, not "today", so the
    // daily cron does not reset a streak just because the current period hasn't
    // had a publication yet. The expiry check below handles the case where the
    // deadline has already passed.
    let currentStreak = 1
    for (let i = weekStarts.length - 1; i > 0; i--) {
      if (isWithinCadence(weekStarts[i - 1], weekStarts[i], intervalWeeks)) {
        currentStreak += 1
      } else {
        break
      }
    }

    const lastPublishedAt = dates.reduce((latest, d) => (d > latest ? d : latest), dates[0])

    // Expire the streak if the deadline for the next publication has already passed.
    if (!isStreakStillActive(lastPublishedAt, intervalWeeks)) {
      currentStreak = 0
    }

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
  // select: { id } keeps the write from referencing intervalWeeks in its RETURNING
  // clause, so the recalculation still works (degraded to weekly) if that column
  // has not been added to writer_streaks yet.
  await prisma.writerStreak.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { id: true },
  })
}
