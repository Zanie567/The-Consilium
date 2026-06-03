import { prisma } from '@/lib/prisma'
import { ENGAGEMENT_WEIGHTS } from '@/lib/constants'

/**
 * Reader engagement score for a single article: a per-article quality signal in
 * roughly the 0-100 range.
 *
 *   score = (avgReadDepth   * READ_DEPTH)
 *         + (bookmarkRate   * BOOKMARK_RATE)
 *         + (commentRate    * COMMENT_RATE)
 *
 * where avgReadDepth, bookmarkRate and commentRate are each on a 0-100 scale and
 * clamped to 100. See ENGAGEMENT_WEIGHTS for the coefficient values and a note on
 * why they differ from the literal coefficients in the original brief.
 *
 * Worked example (10 views, avg read depth 80, 2 bookmarks, 1 comment):
 *   avgReadDepth = 80                 -> 80 * 0.5  = 40
 *   bookmarkRate = (2 / 10) * 100 = 20 -> 20 * 0.03 = 0.6
 *   commentRate  = (1 / 10) * 100 = 10 -> 10 * 0.02 = 0.2
 *   total = 40.8
 */
export async function computeEngagementScore(articleId: string): Promise<number> {
  try {
    const [progressAgg, bookmarkCount, commentCount, article] = await Promise.all([
      prisma.readingProgress.aggregate({
        where: { articleId },
        _avg: { progress: true },
      }),
      prisma.bookmark.count({ where: { articleId } }),
      // Comments has a parentId field, so count only top-level comments.
      prisma.comment.count({ where: { articleId, parentId: null } }),
      prisma.article.findUnique({ where: { id: articleId }, select: { viewCount: true } }),
    ])

    const avgReadDepth = Math.min(progressAgg._avg.progress ?? 0, 100)
    const views = Math.max(article?.viewCount ?? 0, 1)
    const bookmarkRate = Math.min((bookmarkCount / views) * 100, 100)
    const commentRate = Math.min((commentCount / views) * 100, 100)

    const score =
      avgReadDepth * ENGAGEMENT_WEIGHTS.READ_DEPTH +
      bookmarkRate * ENGAGEMENT_WEIGHTS.BOOKMARK_RATE +
      commentRate * ENGAGEMENT_WEIGHTS.COMMENT_RATE

    return Math.round(score * 100) / 100
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[engagement] Failed to compute score for article ${articleId}: ${message}`)
    return 0
  }
}
