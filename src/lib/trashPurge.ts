import { prisma } from '@/lib/prisma'

/**
 * Permanent removal of articles that have sat in trash past the retention period.
 *
 * This used to run silently at the end of every scheduled-publish invocation. When the
 * scheduler was restored on 2026-10-07 after five months off, it hard-deleted two
 * articles while the HTTP response claimed nothing had happened. It is now its own
 * explicit job (POST /api/maintenance/purge-trash) with three guarantees:
 *   - every deleted article is reported (id, title, slug, deletedAt);
 *   - every deletion has an audit_logs row written in the SAME transaction;
 *   - a failure is returned to the caller, never swallowed.
 */

export const TRASH_RETENTION_DAYS = 30
export const TRASH_PURGE_ACTOR = 'system:trash-purge'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Retention can only be LENGTHENED by configuration. 30 days is the promise the Trash UI
 * makes to editors, so it is a floor: a missing, malformed or too-small value (including a
 * caller-supplied option) resolves to 30, never less.
 */
export function clampRetentionDays(days: number): number {
  return Number.isSafeInteger(days) && days > TRASH_RETENTION_DAYS ? days : TRASH_RETENTION_DAYS
}

export function resolveRetentionDays(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return TRASH_RETENTION_DAYS
  return clampRetentionDays(Number(raw.trim()))
}

export interface PurgedArticle {
  id: string
  title: string
  slug: string
  deletedAt: string
}

export interface TrashPurgeResult {
  ranAt: string
  retentionDays: number
  /** Articles deleted at or before this instant are eligible. */
  cutoff: string
  dryRun: boolean
  /** Rows actually removed (always 0 for a dry run). */
  count: number
  articleIds: string[]
  articles: PurgedArticle[]
  /** Dry run only: what a real run would remove right now. */
  wouldPurge: PurgedArticle[]
  errors: { articleId: string; message: string }[]
}

export interface TrashPurgeOptions {
  now?: Date
  retentionDays?: number
  dryRun?: boolean
}

export async function purgeExpiredTrash(options: TrashPurgeOptions = {}): Promise<TrashPurgeResult> {
  const now = options.now ?? new Date()
  const retentionDays = clampRetentionDays(
    options.retentionDays ?? resolveRetentionDays(process.env.TRASH_RETENTION_DAYS),
  )
  const dryRun = options.dryRun ?? false
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  const eligibleWhere = { deletedAt: { not: null, lte: cutoff } }

  // A failure to even list candidates is a real failure: let it propagate.
  const candidates = await prisma.article.findMany({
    where: eligibleWhere,
    select: { id: true, title: true, slug: true, authorId: true, deletedAt: true },
    orderBy: { deletedAt: 'asc' },
  })

  const summarise = (a: (typeof candidates)[number]): PurgedArticle => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    deletedAt: (a.deletedAt as Date).toISOString(),
  })

  const result: TrashPurgeResult = {
    ranAt: now.toISOString(),
    retentionDays,
    cutoff: cutoff.toISOString(),
    dryRun,
    count: 0,
    articleIds: [],
    articles: [],
    wouldPurge: dryRun ? candidates.map(summarise) : [],
    errors: [],
  }
  if (dryRun) return result

  for (const article of candidates) {
    const summary = summarise(article)
    try {
      // One transaction per article: the audit row and the delete commit together or not
      // at all. The delete re-states the retention condition, so a row restored (or
      // re-trashed) after the SELECT above is left alone, and a second run is a no-op.
      const removed = await prisma.$transaction(async (tx) => {
        const res = await tx.article.deleteMany({ where: { id: article.id, ...eligibleWhere } })
        if (res.count === 0) return false
        await tx.auditLog.create({
          data: {
            action: 'ARTICLE_HARD_DELETED',
            targetId: article.id,
            targetType: 'article',
            performedBy: TRASH_PURGE_ACTOR,
            metadata: {
              source: 'trash-retention-purge',
              title: article.title,
              slug: article.slug,
              authorId: article.authorId,
              deletedAt: summary.deletedAt,
              purgedAt: now.toISOString(),
              retentionDays,
            },
          },
        })
        return true
      })
      if (removed) {
        result.count += 1
        result.articleIds.push(article.id)
        result.articles.push(summary)
      }
    } catch (error) {
      result.errors.push({
        articleId: article.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
