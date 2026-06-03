import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ACHIEVEMENT_TYPES, NOTIFICATION_TYPE_ACHIEVEMENT } from '@/lib/constants'

/** Whether a thrown error is a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/** Minimum number of articles a series needs before it can count as complete. */
const SERIES_MIN_PARTS = 2

/**
 * One-time writer achievements awarded when an article becomes PUBLISHED.
 *
 * Called from the scheduled-publishing flow (see lib/scheduledPublishing.ts).
 * Every entry point is internally guarded and never throws, so awarding a
 * milestone can never block or fail the underlying publish.
 */

export interface PublishedArticleRef {
  id: string
  /** Non-null in the schema, but typed nullable so we can skip silently if absent. */
  authorId: string | null
  seriesId: string | null
  title: string
}

/**
 * First-publish milestone: granted the first time any of a writer's articles
 * reaches PUBLISHED. Granted at most once per writer, regardless of how many
 * articles they later publish.
 */
async function awardFirstPublishAchievement(article: PublishedArticleRef): Promise<void> {
  const userId = article.authorId
  if (!userId) return // No author: skip silently.

  // Fast path: the writer already has the milestone (the common case once they
  // have published before). Avoids opening a transaction on every later publish.
  const existing = await prisma.writerAchievement.findFirst({
    where: { userId, type: ACHIEVEMENT_TYPES.FIRST_PUBLISH },
    select: { id: true },
  })
  if (existing) return

  // referenceId stays as the article id so the record shows which article was the
  // first (and so the achievements API can join its title). That means the
  // (userId, type, referenceId) unique cannot by itself enforce one-per-writer, so
  // two concurrent publish runs (GitHub Actions and Vercel cron can overlap) could
  // otherwise insert two first_publish rows for two different first articles. A
  // Serializable transaction closes that race: the re-check plus insert form a
  // predicate that Postgres SSI uses to abort the losing run. The notification is
  // inside the transaction so it is sent only when the row is actually created.
  try {
    await prisma.$transaction(
      async (tx) => {
        const concurrent = await tx.writerAchievement.findFirst({
          where: { userId, type: ACHIEVEMENT_TYPES.FIRST_PUBLISH },
          select: { id: true },
        })
        if (concurrent) return

        await tx.writerAchievement.create({
          data: { userId, type: ACHIEVEMENT_TYPES.FIRST_PUBLISH, referenceId: article.id },
        })
        await tx.notification.create({
          data: {
            userId,
            type: NOTIFICATION_TYPE_ACHIEVEMENT,
            title: 'First article published',
            message: 'Your first article has been published. Welcome to The Consilium.',
            articleId: article.id,
          },
        })
      },
      { isolationLevel: 'Serializable' }
    )
  } catch (err) {
    // A serialization failure means a concurrent run won the race and already
    // awarded the milestone, so this is a no-op rather than a real error.
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[achievements] first_publish not awarded for user ${userId} (concurrent award or conflict): ${message}`
    )
  }
}

/**
 * Series-completion milestone.
 *
 * The Series model has no part-count field, so completion is defined
 * structurally: a series of at least two non-deleted articles in which every one
 * is PUBLISHED (none left in DRAFT, PENDING_REVIEW, SCHEDULED, REJECTED or
 * ARCHIVED). When that holds, each distinct author across the series is granted a
 * one-time series_complete achievement keyed by the series id, plus a
 * notification.
 *
 * Idempotency: referenceId is the series id, so the (userId, type, referenceId)
 * unique fully dedupes. Re-publishing a later correction re-runs this check and
 * the create raises P2002, which we swallow so no second achievement or
 * notification is produced. The unique constraint also makes concurrent publish
 * runs safe: only one create per author can win.
 */
async function awardSeriesCompletionAchievement(article: PublishedArticleRef): Promise<void> {
  const seriesId = article.seriesId
  if (!seriesId) return

  const seriesArticles = await prisma.article.findMany({
    where: { seriesId, deletedAt: null },
    select: { status: true, authorId: true },
  })

  // A single-article series cannot be "complete".
  if (seriesArticles.length < SERIES_MIN_PARTS) return

  // Every current article in the series must be published.
  if (!seriesArticles.every((a) => a.status === 'PUBLISHED')) return

  const authorIds = Array.from(
    new Set(seriesArticles.map((a) => a.authorId).filter((id): id is string => Boolean(id)))
  )

  for (const authorId of authorIds) {
    try {
      await prisma.writerAchievement.create({
        data: {
          userId: authorId,
          type: ACHIEVEMENT_TYPES.SERIES_COMPLETE,
          referenceId: seriesId,
        },
      })
    } catch (err) {
      // P2002: this author already holds the series_complete achievement for this
      // series. Expected on a later re-publish or a concurrent run; swallow it and
      // skip the notification so each author is notified exactly once.
      if (isUniqueViolation(err)) continue
      throw err
    }

    // Reached only when the achievement row was newly created above.
    try {
      await prisma.notification.create({
        data: {
          userId: authorId,
          type: NOTIFICATION_TYPE_ACHIEVEMENT,
          title: 'Series complete',
          message: 'All parts of the series have been published.',
          articleId: article.id,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[achievements] series_complete notification failed for user ${authorId}: ${message}`
      )
    }
  }
}

/**
 * Awards every publish-triggered achievement for a freshly published article.
 * Each milestone is isolated so one failing does not prevent the other, and the
 * function as a whole never throws.
 */
export async function awardPublishAchievements(article: PublishedArticleRef): Promise<void> {
  try {
    await awardFirstPublishAchievement(article)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[achievements] first_publish award failed for article ${article.id}: ${message}`)
  }

  try {
    await awardSeriesCompletionAchievement(article)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[achievements] series_complete award failed for article ${article.id}: ${message}`)
  }
}
