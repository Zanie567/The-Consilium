/**
 * Administrative lifecycle of a debate: unpublish, publish, soft delete, restore and
 * permanent delete.
 *
 *   published --unpublish--> unpublished --publish--> published
 *   published|unpublished --delete--> deleted --restore--> unpublished
 *   deleted --purge--> (gone; the two articles go to the article Trash)
 *
 * Restoring a deleted debate returns it to UNPUBLISHED, never straight to public: an
 * administrator re-publishes it deliberately.
 *
 * A debate is two published articles (`isDebate`) plus the vote record. Hiding only the
 * debate would leave both sides publicly reachable (category pages, archive, search,
 * sitemap), so the articles follow the debate: hiding moves PUBLISHED -> ARCHIVED, which
 * every public article query already excludes, and showing moves back ONLY the articles this
 * lifecycle itself archived.
 *
 * "This lifecycle itself archived" is recorded on the article (`hiddenByDebateAt`, set in the same
 * UPDATE that archives it). The database clears it on any other status or trash change (trigger
 * articles_clear_hidden_by_debate), so an editor's deliberate decision always wins:
 *   - an article an editor archived on purpose has no marker and is never restored here;
 *   - an article an editor trashed, restored, drafted or republished since has lost its marker;
 *   - SCHEDULED articles are never touched (only PUBLISHED ones are hidden). While the debate is
 *     hidden the scheduled-publish job is refused for them by the database guard and skips them;
 *     once the debate is published again the job publishes them when due.
 * Articles left non-public after "publish" are counted in `articlesNotRestored` so the
 * administrator is told to republish them from the article editor.
 *
 * Every transition runs in one transaction with its audit row, and every write is guarded
 * on the row exactly as it was read (including `updatedAt`), so a duplicate click, a
 * second administrator or a concurrent edit produces a clear refusal and never a partial
 * or double application. Authorisation is the caller's job (the route is ADMIN only).
 */
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { debateVisibility } from '@/lib/debateVisibility'

export const DEBATE_ACTIONS = ['unpublish', 'publish', 'delete', 'restore', 'purge'] as const
export type DebateAction = (typeof DEBATE_ACTIONS)[number]

export function isDebateAction(value: unknown): value is DebateAction {
  return typeof value === 'string' && (DEBATE_ACTIONS as readonly string[]).includes(value)
}

export type DebateLifecycleErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'STALE'
  | 'CONFLICT'
  | 'CONFIRMATION_REQUIRED'

export class DebateLifecycleError extends Error {
  constructor(
    readonly code: DebateLifecycleErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export interface DebateActor {
  id: string
}

export interface TransitionOptions {
  /** ISO `updatedAt` the administrator was looking at. A mismatch is refused as stale. */
  expectedUpdatedAt?: string
  /** Typed title, required for a permanent delete. */
  confirmTitle?: string
  now?: Date
}

export interface TransitionResult {
  id: string
  action: DebateAction
  /** Visibility after the action; `null` once the debate no longer exists. */
  visibility: ReturnType<typeof debateVisibility> | null
  articlesChanged: number
  /**
   * After "publish": articles of this debate that are still not public (archived or trashed on purpose, drafted, ...).
   * They are never restored automatically. 0 for every other action.
   */
  articlesNotRestored: number
  votesRemoved: number
  /** False when the change committed but the public caches could not be refreshed immediately. */
  publicCacheRefreshed: boolean
}

const AUDIT_ACTION: Record<DebateAction, string> = {
  unpublish: 'DEBATE_UNPUBLISHED',
  publish: 'DEBATE_PUBLISHED',
  delete: 'DEBATE_DELETED',
  restore: 'DEBATE_RESTORED',
  purge: 'DEBATE_PERMANENTLY_DELETED',
}

const WRONG_STATE: Record<DebateAction, string> = {
  unpublish: 'Only a published debate can be unpublished.',
  publish: 'Only an unpublished debate can be published. Restore a deleted debate first.',
  delete: 'This debate is already deleted.',
  restore: 'Only a deleted debate can be restored.',
  purge: 'A debate must be deleted before it can be permanently removed.',
}

function allowed(action: DebateAction, state: ReturnType<typeof debateVisibility>): boolean {
  switch (action) {
    case 'unpublish': return state === 'published'
    case 'publish': return state === 'unpublished'
    case 'delete': return state !== 'deleted'
    case 'restore': return state === 'deleted'
    case 'purge': return state === 'deleted'
  }
}

export async function transitionDebate(
  actor: DebateActor,
  debateId: string,
  action: DebateAction,
  options: TransitionOptions = {},
  client: typeof prisma = prisma,
): Promise<TransitionResult> {
  const now = options.now ?? new Date()

  const result = await client.$transaction(async (tx): Promise<TransitionResult> => {
    const debate = await tx.debate.findUnique({
      where: { id: debateId },
      select: {
        id: true, title: true, isActive: true, forArticleId: true, againstArticleId: true,
        unpublishedAt: true, deletedAt: true, updatedAt: true,
      },
    })
    if (!debate) throw new DebateLifecycleError('NOT_FOUND', 'That debate no longer exists.', 404)

    if (options.expectedUpdatedAt && options.expectedUpdatedAt !== debate.updatedAt.toISOString()) {
      throw new DebateLifecycleError('STALE', 'This debate changed since you opened it. Reload and review it before acting.', 409)
    }
    const before = debateVisibility(debate)
    if (!allowed(action, before)) throw new DebateLifecycleError('INVALID_STATE', WRONG_STATE[action], 409)

    if (action === 'purge' && options.confirmTitle?.trim() !== debate.title.trim()) {
      throw new DebateLifecycleError('CONFIRMATION_REQUIRED', 'Type the debate title exactly to confirm permanent deletion.', 400)
    }

    const articleIds = [debate.forArticleId, debate.againstArticleId]
    // The row exactly as read. Another request that got here first changes updatedAt,
    // so ours matches nothing and is refused instead of overwriting it.
    const guard = { id: debate.id, updatedAt: debate.updatedAt, deletedAt: debate.deletedAt, unpublishedAt: debate.unpublishedAt }
    const refuse = () => new DebateLifecycleError('CONFLICT', 'Another change was applied to this debate at the same time. Reload and try again.', 409)

    let articlesChanged = 0
    let articlesNotRestored = 0
    let votesRemoved = 0
    let visibility: TransitionResult['visibility'] = before

    if (action === 'unpublish' || action === 'delete') {
      const data: Prisma.DebateUpdateManyMutationInput = {
        // A hidden debate must not stay the featured one.
        isActive: false,
        unpublishedAt: debate.unpublishedAt ?? now,
        ...(action === 'delete' ? { deletedAt: now, deletedById: actor.id } : {}),
      }
      const updated = await tx.debate.updateMany({ where: guard, data })
      if (updated.count !== 1) throw refuse()
      // Only PUBLISHED articles are hidden, and each one is marked in the same statement. Re-running this (an
      // already hidden debate, or delete after unpublish) matches nothing and keeps the original marker.
      articlesChanged = (await tx.article.updateMany({
        where: { id: { in: articleIds }, status: 'PUBLISHED', deletedAt: null },
        data: { status: 'ARCHIVED', hiddenByDebateAt: now },
      })).count
      visibility = action === 'delete' ? 'deleted' : 'unpublished'
    } else if (action === 'publish') {
      const updated = await tx.debate.updateMany({ where: guard, data: { unpublishedAt: null } })
      if (updated.count !== 1) throw refuse()
      // Restore only what this lifecycle hid and nobody has touched since. The conditions are re-checked by the
      // database against the current row, so a concurrent editorial change (which clears the marker) is not overwritten.
      articlesChanged = (await tx.article.updateMany({
        where: { id: { in: articleIds }, status: 'ARCHIVED', deletedAt: null, hiddenByDebateAt: { not: null } },
        data: { status: 'PUBLISHED', hiddenByDebateAt: null },
      })).count
      articlesNotRestored = await tx.article.count({
        where: { id: { in: articleIds }, NOT: { status: 'PUBLISHED', deletedAt: null } },
      })
      visibility = 'published'
    } else if (action === 'restore') {
      const updated = await tx.debate.updateMany({ where: guard, data: { deletedAt: null, deletedById: null } })
      if (updated.count !== 1) throw refuse()
      visibility = 'unpublished'
    } else {
      votesRemoved = await tx.debateVote.count({ where: { debateId: debate.id } })
      // Votes go with the debate (FK cascade). Both articles are kept, in the normal
      // Trash, so the retention purge can later remove them: nothing references them now.
      const removed = await tx.debate.deleteMany({ where: guard })
      if (removed.count !== 1) throw refuse()
      articlesChanged = (await tx.article.updateMany({
        where: { id: { in: articleIds }, deletedAt: null },
        data: { deletedAt: now },
      })).count
      visibility = null
    }

    await tx.auditLog.create({
      data: {
        action: AUDIT_ACTION[action],
        targetId: debate.id,
        targetType: 'debate',
        performedBy: actor.id,
        metadata: {
          title: debate.title,
          from: before,
          to: visibility ?? 'removed',
          articleIds,
          articlesChanged,
          ...(action === 'publish' ? { articlesNotRestored } : {}),
          ...(action === 'purge' ? { votesRemoved } : {}),
        },
      },
    })

    return { id: debate.id, action, visibility, articlesChanged, articlesNotRestored, votesRemoved, publicCacheRefreshed: false }
  })

  // Only after the transaction has committed: a rolled-back change must never expire a cache.
  return { ...result, publicCacheRefreshed: revalidateDebateSurfaces() }
}

/** After commit only: public pages that list debates or their articles. Never throws; returns whether everything refreshed. */
export function revalidateDebateSurfaces(): boolean {
  let ok = revalidateArticleLists()
  for (const path of ['/', '/opinion-debate']) {
    try {
      revalidatePath(path)
    } catch (error) {
      ok = false
      console.error('[debate] revalidatePath failed', path, error)
    }
  }
  return ok
}
