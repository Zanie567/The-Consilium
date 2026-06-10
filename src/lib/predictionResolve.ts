import { prisma } from './prisma'
import { computeScores } from './predictions'

export type ResolveOutcome =
  | { resolved: true; scored: number }
  | { resolved: false; scored: 0; reason: string }

/**
 * Resolves a prediction event against the actual released value and scores
 * every prediction in one pass. Shared by the auto-scoring cron and the manual
 * resolve action in the editorial portal.
 *
 * Idempotency: the event row is claimed with a conditional updateMany that
 * only matches while the event is still unresolved (status OPEN or CLOSED and
 * resolvedAt null). A second run, or a concurrent run, matches zero rows and
 * returns without touching any scores, so double-scoring is impossible.
 */
export async function resolvePredictionEvent(
  eventId: string,
  actualValue: number
): Promise<ResolveOutcome> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.predictionEvent.updateMany({
      where: {
        id: eventId,
        status: { in: ['OPEN', 'CLOSED'] },
        resolvedAt: null,
      },
      data: {
        status: 'RESOLVED',
        actualValue,
        resolvedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      return {
        resolved: false,
        scored: 0,
        reason: 'Event is already resolved or cancelled.',
      } as const
    }

    const event = await tx.predictionEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { deadline: true, maxError: true },
    })
    const predictions = await tx.prediction.findMany({
      where: { eventId },
      select: { id: true, value: true, updatedAt: true },
    })

    const scores = computeScores(
      predictions.map((p) => ({ id: p.id, value: Number(p.value), updatedAt: p.updatedAt })),
      actualValue,
      Number(event.maxError),
      event.deadline
    )

    if (scores.length > 0) {
      // One set-based statement instead of a round-trip per prediction, so a
      // large event cannot push the transaction past its timeout. It also
      // leaves updatedAt untouched, preserving the submission timestamp the
      // late-entry guard reads.
      const ids = scores.map((s) => s.id)
      const points = scores.map((s) => s.points)
      const absErrors = scores.map((s) => s.absError)
      const ranks = scores.map((s) => s.rank)
      await tx.$executeRaw`
        UPDATE "predictions" AS p
        SET "points" = d.points, "absError" = d.abs_error, "rank" = d.rank
        FROM (
          SELECT unnest(${ids}::text[])        AS id,
                 unnest(${points}::numeric[])  AS points,
                 unnest(${absErrors}::numeric[]) AS abs_error,
                 unnest(${ranks}::int[])       AS rank
        ) AS d
        WHERE p.id = d.id
      `
    }

    return { resolved: true, scored: scores.length } as const
  })
}
