import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicDebateWhere } from '@/lib/debateVisibility'
import { withTransactionRetry } from '@/lib/transactionRetry'

/**
 * Creating a vote must be atomic with the visibility rule. Checking "is this debate public" and inserting the vote
 * as two separate statements leaves a window in which an editor can archive or trash an argument (or an
 * administrator can hide the debate): the vote would then be recorded for a debate that is no longer public.
 *
 * Inside one transaction this takes SHARED row locks on both articles, then on the debate and every debate that
 * references either article, and only then re-evaluates the one shared rule (publicDebateWhere) and inserts.
 *   - A visibility change that commits first is seen by the re-check (READ COMMITTED re-reads after the lock), so
 *     the vote is refused.
 *   - A visibility change that has not committed yet must UPDATE one of the locked rows, so it waits for this
 *     transaction; the vote is stored, then the change applies. Existing votes are never deleted by a hide.
 *
 * Lock order is articles (by id) then debates (by id), the order every other writer uses (issue #128):
 *   - transitionDebate locks the debate's two articles, then writes the debate row;
 *   - an editorial write that makes an article public (save, review approval, trash restore, the scheduled-publish
 *     job) locks the article row and then, inside the trigger articles_hidden_debate_guard, takes FOR SHARE on every
 *     debate that references the article. So such a write holds an article and waits for its debates, never the
 *     reverse. An article write that does not make it public (archive, draft, trash) locks only the article row.
 * Because nobody holds a debate while waiting for an article, these transactions cannot deadlock with each other.
 */
export type PublicVoteOutcome<T> = { visible: true; value: T } | { visible: false }

/**
 * Bounds for the vote transaction, so a held lock fails fast with a clear "try again" (503) instead of hanging.
 *
 * Prisma's `timeout` alone cannot do this: it does not cancel a statement that is waiting for a row lock (measured
 * with @prisma/adapter-pg 7.6 on PostgreSQL 17: the transaction stayed blocked until the other side released the
 * lock, then failed with P2028). The server-side `lock_timeout` does: each statement gives up after
 * VOTE_LOCK_TIMEOUT_MS with SQLSTATE 55P03 and the transaction rolls back, leaving no vote behind. It is scoped to
 * this transaction (set_config(..., true) = SET LOCAL), which is also correct behind the Supabase transaction pooler.
 *
 * At most three statements can wait for a lock (the article locks, the debate locks, and the insert behind a
 * concurrent duplicate), so 3 x 1.5 s stays inside the 5 s `timeout`. A normal vote takes a few milliseconds and the
 * longest legitimate holder, an article save, is a few hundred. `maxWait` (a pooled connection and BEGIN) keeps
 * Prisma's default of 2 s, now explicit.
 */
export const VOTE_LOCK_TIMEOUT_MS = 1_500
export const VOTE_TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 5_000 } as const

export async function withPublicDebate<T>(
  debateId: string,
  work: (tx: Prisma.TransactionClient, debate: { isActive: boolean; closesAt: Date | null }) => Promise<T>,
): Promise<PublicVoteOutcome<T>> {
  // Retried only when PostgreSQL aborted the whole transaction (deadlock or serialization failure): `work` is the
  // vote insert and nothing else, so running it again cannot double-count. A busy lock is reported, not retried.
  return withTransactionRetry('debate:vote', () => prisma.$transaction(async (tx): Promise<PublicVoteOutcome<T>> => {
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${VOTE_LOCK_TIMEOUT_MS}ms`}, true)`
    const ref = await tx.debate.findUnique({ where: { id: debateId }, select: { forArticleId: true, againstArticleId: true } })
    if (!ref) return { visible: false }
    const articleIds = Prisma.join([ref.forArticleId, ref.againstArticleId])

    await tx.$queryRaw`SELECT id FROM articles WHERE id IN (${articleIds}) ORDER BY id FOR SHARE`
    // Every debate that points at either article can change what "public" means for this one (an article of a
    // hidden debate is never public), so those rows are held too.
    await tx.$queryRaw`
      SELECT id FROM debates
      WHERE id = ${debateId} OR "forArticleId" IN (${articleIds}) OR "againstArticleId" IN (${articleIds})
      ORDER BY id FOR SHARE`

    const debate = await tx.debate.findFirst({ where: publicDebateWhere({ id: debateId }), select: { isActive: true, closesAt: true } })
    if (!debate) return { visible: false }
    return { visible: true, value: await work(tx, debate) }
  }, VOTE_TRANSACTION_OPTIONS))
}

/** The voter identities debate_votes deduplicates on, each unique together with debateId (see the Prisma schema). */
const VOTER_IDENTITY_FIELDS = new Set(['userId', 'anonymousId', 'anonIpHash'])
const VOTE_UNIQUE_CONSTRAINTS = new Set([
  'debate_votes_debateId_userId_key',
  'debate_votes_debateId_anonymousId_key',
  'debate_votes_debateId_anonIpHash_key',
])

/** The columns (or constraint name) Prisma reports for a unique violation, unquoted. */
function uniqueViolationTarget(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = (error.meta ?? {}) as Record<string, unknown>
  // Prisma's query engine reports `target` (a field list, or the constraint name). Driver adapters such as
  // @prisma/adapter-pg instead report the columns PostgreSQL named in its "Key (...)" detail.
  const adapterCause = (meta.driverAdapterError as { cause?: { constraint?: { fields?: unknown } } } | undefined)?.cause
  const raw = meta.target ?? adapterCause?.constraint?.fields
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return list.filter((v): v is string => typeof v === 'string').map((v) => v.replace(/^"|"$/g, ''))
}

/**
 * True only for a unique violation on one of the vote deduplication constraints, i.e. this voter has already voted
 * on this debate. Any other failure, including a unique violation elsewhere, is a real error and is not reported to
 * the voter as "already voted".
 */
export function isDuplicateVote(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const model = (error.meta as { modelName?: unknown } | undefined)?.modelName
  if (model !== undefined && model !== 'DebateVote') return false
  const target = uniqueViolationTarget(error)
  if (target.some((name) => VOTE_UNIQUE_CONSTRAINTS.has(name))) return true
  return target.includes('debateId') && target.some((field) => VOTER_IDENTITY_FIELDS.has(field))
}
