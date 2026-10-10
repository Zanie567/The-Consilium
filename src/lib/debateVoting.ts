import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicDebateWhere } from '@/lib/debateVisibility'

/**
 * Creating a vote must be atomic with the visibility rule. Checking "is this debate public" and inserting the vote
 * as two separate statements leaves a window in which an editor can archive or trash an argument (or an
 * administrator can hide the debate): the vote would then be recorded for a debate that is no longer public.
 *
 * Inside one transaction this takes SHARED row locks on the debate, on every debate that references either
 * article, and on both articles, and only then re-evaluates the one shared rule (publicDebateWhere) and inserts.
 *   - A visibility change that commits first is seen by the re-check (READ COMMITTED re-reads after the lock), so
 *     the vote is refused.
 *   - A visibility change that has not committed yet must UPDATE one of the locked rows, so it waits for this
 *     transaction; the vote is stored, then the change applies. Existing votes are never deleted by a hide.
 * Lock order is debates (by id) then articles (by id), the same order transitionDebate uses (debate row, then its
 * articles), so the two cannot deadlock. Editorial article edits lock only an article row.
 */
export type PublicVoteOutcome<T> = { visible: true; value: T } | { visible: false }

export async function withPublicDebate<T>(
  debateId: string,
  work: (tx: Prisma.TransactionClient, debate: { isActive: boolean; closesAt: Date | null }) => Promise<T>,
): Promise<PublicVoteOutcome<T>> {
  return prisma.$transaction(async (tx): Promise<PublicVoteOutcome<T>> => {
    const ref = await tx.debate.findUnique({ where: { id: debateId }, select: { forArticleId: true, againstArticleId: true } })
    if (!ref) return { visible: false }
    const articleIds = Prisma.join([ref.forArticleId, ref.againstArticleId])

    // Every debate that points at either article can change what "public" means for this one (an article of a
    // hidden debate is never public), so those rows are held too. Sorted: a consistent order cannot deadlock.
    await tx.$queryRaw`
      SELECT id FROM debates
      WHERE id = ${debateId} OR "forArticleId" IN (${articleIds}) OR "againstArticleId" IN (${articleIds})
      ORDER BY id FOR SHARE`
    await tx.$queryRaw`SELECT id FROM articles WHERE id IN (${articleIds}) ORDER BY id FOR SHARE`

    const debate = await tx.debate.findFirst({ where: publicDebateWhere({ id: debateId }), select: { isActive: true, closesAt: true } })
    if (!debate) return { visible: false }
    return { visible: true, value: await work(tx, debate) }
  })
}
