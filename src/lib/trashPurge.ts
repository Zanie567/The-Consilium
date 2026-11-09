import { prisma } from '@/lib/prisma'
import { lockArticleImageReferences, queueDeletedArticleImages } from '@/lib/articleImageStorage'

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
 *
 * Debate-linked articles are RETAINED, not purged. A debate row (live, unpublished or soft-deleted) points
 * at its two articles with ON DELETE RESTRICT foreign keys, and the debate's votes hang off the debate. So
 * while any debate references an article, the article stays, however long it has been in the Trash. It
 * becomes eligible only after an administrator permanently deletes the debate (src/lib/debateLifecycle.ts,
 * which keeps the article's original trash date), and then by the ordinary 30-day rule. Retained articles
 * are listed in `retained`, never as errors: on 2026-11-09 six of them made every daily run fail (HTTP 500)
 * although nothing was wrong. The foreign keys stay as the last line of defence: a debate that starts
 * referencing an article while this job runs makes that delete fail and roll back, and it is reported as
 * an error.
 */

export const TRASH_RETENTION_DAYS = 30
export const TRASH_PURGE_ACTOR = 'system:trash-purge'
/** Articles purged per run: bounds the work (and the transaction count) of one invocation. */
export const PURGE_BATCH_SIZE = 100

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

/** A debate that references a retained article, and which side the article argues. */
export interface RetainingDebate {
  debateId: string
  position: 'for' | 'against'
}

export const DEBATE_RETENTION_REASON = 'referenced-by-debate'

/** An article past retention that is kept because a debate still references it. */
export interface RetainedArticle {
  id: string
  deletedAt: string
  reason: typeof DEBATE_RETENTION_REASON
  /** Every debate referencing the article, sorted by debate id, then position. Never empty. */
  debates: RetainingDebate[]
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
  /**
   * Articles past retention that are kept because a debate references them (real runs and dry runs alike).
   * One entry per article, oldest trash date first, then by id; at most PURGE_BATCH_SIZE entries.
   */
  retained: RetainedArticle[]
  /** How many articles past retention are retained in total (`retained` may list fewer). */
  retainedCount: number
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
  const pastRetention = { deletedAt: { not: null, lte: cutoff } }
  // Eligible = past retention AND no debate references the article. The delete below re-states the whole
  // condition, so a reference that appears after the listing is honoured too.
  const eligibleWhere = { ...pastRetention, forDebates: { none: {} }, againstDebates: { none: {} } }
  const retainedWhere = { ...pastRetention, OR: [{ forDebates: { some: {} } }, { againstDebates: { some: {} } }] }

  // A failure to even list candidates is a real failure: let it propagate. Each run works through
  // a bounded, oldest-first batch; anything left is picked up by the next daily run. `content` and
  // `coverImage` are read so the article's managed images can be queued for cleanup with the delete.
  const listed = await prisma.article.findMany({
    where: eligibleWhere,
    select: {
      id: true, title: true, slug: true, authorId: true, deletedAt: true,
      updatedAt: true, content: true, coverImage: true,
    },
    orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
    take: PURGE_BATCH_SIZE,
  })

  // Reported separately, by the same oldest-first order, so a run's output is deterministic.
  const [retainedRows, retainedCount] = await Promise.all([
    prisma.article.findMany({
      where: retainedWhere,
      select: {
        id: true,
        deletedAt: true,
        forDebates: { select: { id: true } },
        againstDebates: { select: { id: true } },
      },
      orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
      take: PURGE_BATCH_SIZE,
    }),
    prisma.article.count({ where: retainedWhere }),
  ])
  const retained: RetainedArticle[] = retainedRows.map((a) => ({
    id: a.id,
    deletedAt: (a.deletedAt as Date).toISOString(),
    reason: DEBATE_RETENTION_REASON,
    debates: [
      ...a.forDebates.map((d) => ({ debateId: d.id, position: 'for' as const })),
      ...a.againstDebates.map((d) => ({ debateId: d.id, position: 'against' as const })),
    ].sort((x, y) => (x.debateId === y.debateId ? x.position.localeCompare(y.position) : x.debateId < y.debateId ? -1 : 1)),
  }))

  // The two reads are not one snapshot: if a debate starts referencing an article between them, the article
  // is listed as retained and not attempted, so it never appears in both lists.
  const retainedIds = new Set(retained.map((a) => a.id))
  const candidates = listed.filter((a) => !retainedIds.has(a.id))

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
    retained,
    retainedCount,
    errors: [],
  }
  if (dryRun) return result

  for (const article of candidates) {
    const summary = summarise(article)
    try {
      // One transaction per article: the image locks, the delete, the image-cleanup queueing and the
      // audit row commit together or not at all. The delete re-states the eligibility condition (retention
      // and no debate reference) and is guarded on the row exactly as listed, so a row restored, re-trashed,
      // EDITED or newly referenced by a debate after the SELECT above is left alone, and a second run is a no-op.
      const removed = await prisma.$transaction(async (tx) => {
        // Same reference locks article saves take, so a concurrent save cannot re-attach an image
        // that is about to be queued for removal.
        await lockArticleImageReferences(tx, article.content, article.coverImage)
        const res = await tx.article.deleteMany({
          where: { id: article.id, updatedAt: article.updatedAt, ...eligibleWhere },
        })
        if (res.count === 0) return false
        // Record cleanup eligibility atomically; storage I/O itself happens later, not in cron.
        await queueDeletedArticleImages(tx, article.content, article.coverImage)
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
