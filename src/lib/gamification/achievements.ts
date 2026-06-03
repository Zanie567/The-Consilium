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

  // Guard against a *different* article creating a second first-publish row:
  // the unique key includes referenceId, so an upsert alone would not stop that.
  const existing = await prisma.writerAchievement.findFirst({
    where: { userId, type: ACHIEVEMENT_TYPES.FIRST_PUBLISH },
    select: { id: true },
  })
  if (existing) return

  // Upsert on the (userId, type, referenceId) unique key guards against the same
  // article being processed twice (e.g. overlapping cron runs).
  await prisma.writerAchievement.upsert({
    where: {
      userId_type_referenceId: {
        userId,
        type: ACHIEVEMENT_TYPES.FIRST_PUBLISH,
        referenceId: article.id,
      },
    },
    create: { userId, type: ACHIEVEMENT_TYPES.FIRST_PUBLISH, referenceId: article.id },
    update: {},
  })

  await prisma.notification.create({
    data: {
      userId,
      type: NOTIFICATION_TYPE_ACHIEVEMENT,
      title: 'First article published',
      message: 'Your first article has been published. Welcome to The Consilium.',
      articleId: article.id,
    },
  })
}

/**
 * Series-completion milestone.
 *
 * This cannot be awarded as specified: the Series model has no field describing
 * the expected number of parts (no partCount / totalParts / equivalent), so
 * "all parts published" is undeterminable. Per spec we do not guess a total; we
 * log a warning and skip. If a totalParts column is added to the series table,
 * the completion check and per-author award/notification can be wired in here.
 */
async function awardSeriesCompletionAchievement(article: PublishedArticleRef): Promise<void> {
  if (!article.seriesId) return

  const series = await prisma.series.findUnique({
    where: { id: article.seriesId },
    select: { id: true, title: true },
  })
  if (!series) return

  console.warn(
    `[achievements] Series "${series.title}" (${series.id}) has no part-count field; ` +
      'skipping series-completion award. Add a totalParts column to the series table to enable it.'
  )
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
