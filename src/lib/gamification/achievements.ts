import { prisma } from '@/lib/prisma'
import { ACHIEVEMENT_TYPES, NOTIFICATION_TYPE_ACHIEVEMENT } from '@/lib/constants'

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

// Logged at most once per process rather than on every series-article publish.
let seriesCompletionWarned = false

/**
 * Series-completion milestone.
 *
 * This cannot be awarded as specified: the Series model has no field describing
 * the expected number of parts (no partCount / totalParts / equivalent), so
 * "all parts published" is undeterminable. We do not guess a total. No DB lookup
 * is needed to skip; a single warning per process is enough for visibility. If a
 * totalParts column is added to the series table, wire the completion check and
 * per-author award/notification in here.
 */
async function awardSeriesCompletionAchievement(article: PublishedArticleRef): Promise<void> {
  if (!article.seriesId) return

  if (!seriesCompletionWarned) {
    seriesCompletionWarned = true
    console.warn(
      '[achievements] series-completion award is not implemented (Series has no part-count field); skipping.'
    )
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
