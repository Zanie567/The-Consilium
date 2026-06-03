import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { WRITER_AT_RISK } from '@/lib/constants'

/**
 * Internal Growth-role view of writer publishing activity. Shared by the
 * /api/editorial/growth/writer-activity route and the Writer Activity portal
 * page so both compute identical figures from one query path.
 *
 * All Date values are returned as ISO strings so the shape is JSON-serialisable
 * and safe to pass straight from a server component to the client.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface WriterActivityRow {
  id: string
  name: string | null
  email: string | null
  role: Role
  /** Count of this user's PUBLISHED, non-deleted articles. */
  publishedArticleCount: number
  /** publishedAt of their most recent PUBLISHED article, or null. */
  lastPublishedAt: string | null
  /** Whole days since lastPublishedAt, or null when they have never published. */
  daysSinceLastPublish: number | null
  streakData: {
    currentStreak: number
    longestStreak: number
    lastPublishedAt: string | null
  } | null
  /** True when they have published enough to be active but have gone quiet. */
  atRisk: boolean
}

/**
 * Returns every WRITER and EDITOR with their publishing activity, ordered by
 * lastPublishedAt descending with never-published users last.
 */
export async function getWriterActivity(now = new Date()): Promise<WriterActivityRow[]> {
  const [users, grouped] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ['WRITER', 'EDITOR'] } },
      select: { id: true, name: true, email: true, role: true, streakData: true },
    }),
    prisma.article.groupBy({
      by: ['authorId'],
      where: { status: 'PUBLISHED', deletedAt: null },
      _count: { _all: true },
      _max: { publishedAt: true },
    }),
  ])

  const statsByAuthor = new Map(
    grouped.map((g) => [g.authorId, { count: g._count._all, last: g._max.publishedAt }])
  )

  const nowMs = now.getTime()

  const rows: WriterActivityRow[] = users.map((user) => {
    const stat = statsByAuthor.get(user.id)
    const publishedArticleCount = stat?.count ?? 0
    const lastPublished = stat?.last ?? null
    const daysSinceLastPublish = lastPublished
      ? Math.floor((nowMs - lastPublished.getTime()) / MS_PER_DAY)
      : null

    const atRisk =
      publishedArticleCount >= WRITER_AT_RISK.MIN_PUBLISHED &&
      daysSinceLastPublish !== null &&
      daysSinceLastPublish > WRITER_AT_RISK.MAX_DAYS_SINCE_PUBLISH

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      publishedArticleCount,
      lastPublishedAt: lastPublished ? lastPublished.toISOString() : null,
      daysSinceLastPublish,
      streakData: user.streakData
        ? {
            currentStreak: user.streakData.currentStreak,
            longestStreak: user.streakData.longestStreak,
            lastPublishedAt: user.streakData.lastPublishedAt
              ? user.streakData.lastPublishedAt.toISOString()
              : null,
          }
        : null,
      atRisk,
    }
  })

  return rows.sort(compareByLastPublishedDesc)
}

/** Most recently published first; never-published (null) sorts last. */
export function compareByLastPublishedDesc(a: WriterActivityRow, b: WriterActivityRow): number {
  if (a.lastPublishedAt === b.lastPublishedAt) return 0
  if (a.lastPublishedAt === null) return 1
  if (b.lastPublishedAt === null) return -1
  return a.lastPublishedAt < b.lastPublishedAt ? 1 : -1
}
