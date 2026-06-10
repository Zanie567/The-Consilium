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

    for (const s of scores) {
      await tx.prediction.update({
        where: { id: s.id },
        data: { points: s.points, absError: s.absError, rank: s.rank },
      })
    }

    return { resolved: true, scored: scores.length } as const
  })
}
