import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Read-through analytics for writers: where signed-in readers actually stop
 * in an article, computed from ReadingProgress (one row per signed-in user
 * per article, progress = furthest scroll percent 0-100).
 *
 * Honesty constraints baked in here rather than left to the UI:
 *   - Only signed-in readers are visible; callers must label metrics that way.
 *   - Below MIN_READ_THROUGH_SAMPLE readers, distribution metrics are nulled
 *     out server-side so small samples are never over-interpreted.
 *   - Everything is aggregate; no per-user data leaves this module.
 */

export const MIN_READ_THROUGH_SAMPLE = 5

// Retention is measured at decile thresholds: the share of signed-in readers
// whose furthest progress reached at least 10%, 20%, ... 100%.
export const RETENTION_THRESHOLDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const

export interface ReadThroughAggRow {
  readerCount: number
  completedCount: number
  // percentile_cont(0.5) over progress; null when there are no readers.
  medianProgress: number | null
  // Readers whose progress >= each RETENTION_THRESHOLDS entry, same order.
  pastCounts: number[]
}

export interface RetentionPoint {
  threshold: number
  readers: number
  // Share of all signed-in readers, rounded whole percent (0-100).
  share: number
}

export interface SteepestDrop {
  // Thresholds bounding the segment where the most readers stopped,
  // e.g. from 30 to 40 means "between 30% and 40% of the article".
  // from 0 means the drop is between opening the article and the 10% mark.
  from: number
  to: number
  readersLost: number
  // Percentage points of the readership lost in this segment, rounded.
  lostShare: number
}

export interface ArticleReadThrough {
  readerCount: number
  hasEnoughData: boolean
  completionRate: number | null
  medianProgress: number | null
  retention: RetentionPoint[] | null
  steepestDrop: SteepestDrop | null
}

export interface ArticleListReadStats {
  readerCount: number
  hasEnoughData: boolean
  completionRate: number | null
  medianProgress: number | null
}

// ── Pure shaping (unit-testable without a database) ──────────────────────────

export function findSteepestDrop(
  pastCounts: number[],
  readerCount: number
): SteepestDrop | null {
  if (readerCount <= 0) return null
  let best: SteepestDrop | null = null
  let prevCount = readerCount
  let prevThreshold = 0
  for (let i = 0; i < RETENTION_THRESHOLDS.length; i++) {
    const lost = prevCount - pastCounts[i]
    // Strictly greater keeps the earliest segment on ties, which is the most
    // useful one for a writer to look at first.
    if (lost > 0 && (best === null || lost > best.readersLost)) {
      best = {
        from: prevThreshold,
        to: RETENTION_THRESHOLDS[i],
        readersLost: lost,
        lostShare: Math.round((lost / readerCount) * 100),
      }
    }
    prevCount = pastCounts[i]
    prevThreshold = RETENTION_THRESHOLDS[i]
  }
  return best
}

export function buildRetention(
  pastCounts: number[],
  readerCount: number
): RetentionPoint[] {
  return RETENTION_THRESHOLDS.map((threshold, i) => ({
    threshold,
    readers: pastCounts[i],
    share: readerCount > 0 ? Math.round((pastCounts[i] / readerCount) * 100) : 0,
  }))
}

export function shapeReadThrough(row: ReadThroughAggRow): ArticleReadThrough {
  if (row.readerCount < MIN_READ_THROUGH_SAMPLE) {
    return {
      readerCount: row.readerCount,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
      retention: null,
      steepestDrop: null,
    }
  }
  return {
    readerCount: row.readerCount,
    hasEnoughData: true,
    completionRate: Math.round((row.completedCount / row.readerCount) * 100),
    medianProgress: row.medianProgress === null ? null : Math.round(row.medianProgress),
    retention: buildRetention(row.pastCounts, row.readerCount),
    steepestDrop: findSteepestDrop(row.pastCounts, row.readerCount),
  }
}

export function shapeListStats(row: {
  readerCount: number
  completedCount: number
  medianProgress: number | null
}): ArticleListReadStats {
  if (row.readerCount < MIN_READ_THROUGH_SAMPLE) {
    return {
      readerCount: row.readerCount,
      hasEnoughData: false,
      completionRate: null,
      medianProgress: null,
    }
  }
  return {
    readerCount: row.readerCount,
    hasEnoughData: true,
    completionRate: Math.round((row.completedCount / row.readerCount) * 100),
    medianProgress: row.medianProgress === null ? null : Math.round(row.medianProgress),
  }
}

// ── Database aggregation (grouped SQL, never raw rows into JS) ───────────────

interface RawDetailRow {
  readerCount: number
  completedCount: number
  medianProgress: number | null
  past10: number
  past20: number
  past30: number
  past40: number
  past50: number
  past60: number
  past70: number
  past80: number
  past90: number
  past100: number
}

/**
 * One aggregate query for a single article: reader count, completed count,
 * continuous median of furthest progress, and per-decile retention counts.
 * Postgres does all the work; the app only receives one summary row.
 */
export async function getArticleReadThrough(articleId: string): Promise<ArticleReadThrough> {
  const rows = await prisma.$queryRaw<RawDetailRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int                                                AS "readerCount",
      COUNT(*) FILTER (WHERE completed)::int                       AS "completedCount",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY progress)        AS "medianProgress",
      COUNT(*) FILTER (WHERE progress >= 10)::int                  AS "past10",
      COUNT(*) FILTER (WHERE progress >= 20)::int                  AS "past20",
      COUNT(*) FILTER (WHERE progress >= 30)::int                  AS "past30",
      COUNT(*) FILTER (WHERE progress >= 40)::int                  AS "past40",
      COUNT(*) FILTER (WHERE progress >= 50)::int                  AS "past50",
      COUNT(*) FILTER (WHERE progress >= 60)::int                  AS "past60",
      COUNT(*) FILTER (WHERE progress >= 70)::int                  AS "past70",
      COUNT(*) FILTER (WHERE progress >= 80)::int                  AS "past80",
      COUNT(*) FILTER (WHERE progress >= 90)::int                  AS "past90",
      COUNT(*) FILTER (WHERE progress >= 100)::int                 AS "past100"
    FROM reading_progress
    WHERE "articleId" = ${articleId}
  `)
  const r = rows[0]
  return shapeReadThrough({
    readerCount: r?.readerCount ?? 0,
    completedCount: r?.completedCount ?? 0,
    medianProgress: r?.medianProgress ?? null,
    pastCounts: r
      ? [r.past10, r.past20, r.past30, r.past40, r.past50, r.past60, r.past70, r.past80, r.past90, r.past100]
      : RETENTION_THRESHOLDS.map(() => 0),
  })
}

interface RawListRow {
  articleId: string
  readerCount: number
  completedCount: number
  medianProgress: number | null
}

/**
 * One grouped query for a set of articles (a writer's published pieces):
 * per article reader count, completed count, and median furthest progress.
 */
export async function getReadStatsByArticleIds(
  articleIds: string[]
): Promise<Map<string, ArticleListReadStats>> {
  if (articleIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<RawListRow[]>(Prisma.sql`
    SELECT
      "articleId"                                                  AS "articleId",
      COUNT(*)::int                                                AS "readerCount",
      COUNT(*) FILTER (WHERE completed)::int                       AS "completedCount",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY progress)        AS "medianProgress"
    FROM reading_progress
    WHERE "articleId" IN (${Prisma.join(articleIds)})
    GROUP BY "articleId"
  `)
  return new Map(rows.map((row) => [row.articleId, shapeListStats(row)]))
}

export const EMPTY_LIST_STATS: ArticleListReadStats = {
  readerCount: 0,
  hasEnoughData: false,
  completionRate: null,
  medianProgress: null,
}
