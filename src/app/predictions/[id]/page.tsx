import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requirePredictionsAccess } from '@/lib/predictionsAccess'
import { MAX_POINTS } from '@/lib/predictions'
import { displayAuthorName } from '@/lib/authorUtils'
import { CountdownTimer } from '@/components/predictions/CountdownTimer'
import { PredictionForm } from '@/components/predictions/PredictionForm'
import { DistributionBars } from '@/components/predictions/DistributionBars'
import { EVENT_TYPE_LABELS, eventDisplayState, STATE_BADGE_CLASSES } from '../shared'

export const metadata: Metadata = {
  title: 'Prediction Event',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PredictionEventPage({ params }: Props) {
  const { id } = await params
  const user = await requirePredictionsAccess(`/predictions/${id}`)

  const event = await prisma.predictionEvent.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      unitLabel: true,
      deadline: true,
      releaseDate: true,
      minValue: true,
      maxValue: true,
      maxError: true,
      actualValue: true,
      resolvedAt: true,
      status: true,
      semesterKey: true,
      _count: { select: { predictions: true } },
    },
  })
  if (!event) notFound()

  const myPrediction = await prisma.prediction.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: user.id } },
    select: { value: true, points: true, absError: true, rank: true },
  })

  const now = new Date()
  const state = eventDisplayState(event, now)
  const resolved = event.status === 'RESOLVED' && event.actualValue !== null

  // The distribution and the top ten are only fetched once the deadline has
  // passed (or the event is resolved), never before, so nothing about the
  // field can leak to early submitters. Keyed on the deadline rather than the
  // status: an event closed early could be reopened, and anything shown in
  // between would anchor later entries.
  const showField = resolved || now.getTime() >= event.deadline.getTime()
  const [allValues, topTen] = showField
    ? await Promise.all([
        prisma.prediction.findMany({
          where: { eventId: event.id },
          select: { value: true },
        }),
        resolved
          ? prisma.prediction.findMany({
              where: { eventId: event.id, rank: { not: null } },
              orderBy: { rank: 'asc' },
              take: 10,
              select: {
                rank: true,
                value: true,
                points: true,
                absError: true,
                user: { select: { id: true, name: true } },
              },
            })
          : Promise.resolve([]),
      ])
    : [[], []]

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <section className="bg-navy py-12 px-4 border-b-2 border-gold">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/predictions"
            className="text-cream/40 hover:text-cream/70 text-xs tracking-widest uppercase transition-colors"
          >
            ← All events
          </Link>
          <div className="flex items-center gap-3 mt-4">
            <span className="text-gold/60 text-xs tracking-[0.3em] uppercase">
              {EVENT_TYPE_LABELS[event.type]}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-widest ${STATE_BADGE_CLASSES[state]}`}
            >
              {state}
            </span>
          </div>
          <h1
            className="text-3xl sm:text-4xl font-bold text-gold mt-3"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {event.title}
          </h1>
          {event.description && (
            <p className="text-cream/60 text-sm mt-4 max-w-2xl leading-relaxed">
              {event.description}
            </p>
          )}
          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-6 text-sm">
            <div>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest">Deadline</p>
              <p className="text-cream/80 mt-0.5">
                {format(event.deadline, 'd MMM yyyy, HH:mm')}
                {state === 'Open' && (
                  <span className="text-gold ml-2">
                    (<CountdownTimer deadline={event.deadline.toISOString()} /> left)
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest">Expected release</p>
              <p className="text-cream/80 mt-0.5">{format(event.releaseDate, 'd MMM yyyy')}</p>
            </div>
            <div>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest">Entries</p>
              <p className="text-cream/80 mt-0.5">{event._count.predictions}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {state === 'Open' && (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-6">
            <PredictionForm
              eventId={event.id}
              unitLabel={event.unitLabel}
              minValue={Number(event.minValue)}
              maxValue={Number(event.maxValue)}
              currentValue={myPrediction ? Number(myPrediction.value) : null}
            />
            <p className="text-xs text-[var(--fg-faint)] mt-4">
              Scoring: an exact call earns {MAX_POINTS} points, scaling down to zero at an error of{' '}
              {Number(event.maxError)} {event.unitLabel}. The field of predictions stays hidden
              until the deadline passes.
            </p>
          </section>
        )}

        {state === 'Cancelled' && (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-6">
            <p className="text-sm text-[var(--fg-muted)]">
              This event was cancelled and no points will be awarded.
            </p>
          </section>
        )}

        {state === 'Awaiting result' && (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-6">
            <h2 className="text-xs uppercase tracking-[0.25em] text-[var(--fg-muted)] mb-2">
              Waiting on the official number
            </h2>
            <p className="text-sm text-[var(--fg-muted)]">
              Predictions are locked.
              {myPrediction
                ? ` Yours is in at ${Number(myPrediction.value)} ${event.unitLabel}.`
                : ' You did not enter this one.'}{' '}
              Results appear here once the release lands.
            </p>
          </section>
        )}

        {resolved && (
          <section className="rounded-lg border border-gold/40 bg-[var(--bg-elevated)] p-6">
            <h2 className="text-xs uppercase tracking-[0.25em] text-[var(--fg-muted)] mb-4">
              Result
            </h2>
            <p className="text-3xl font-bold text-gold" style={{ fontFamily: 'var(--font-serif)' }}>
              {Number(event.actualValue)} {event.unitLabel}
            </p>
            {event.resolvedAt && (
              <p className="text-xs text-[var(--fg-faint)] mt-1">
                Resolved {format(event.resolvedAt, 'd MMM yyyy, HH:mm')}
              </p>
            )}
            <div className="mt-5 pt-5 border-t border-[var(--border)]">
              {myPrediction ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                      Your prediction
                    </p>
                    <p className="text-[var(--fg)] font-semibold mt-1">
                      {Number(myPrediction.value)} {event.unitLabel}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                      Your error
                    </p>
                    <p className="text-[var(--fg)] font-semibold mt-1">
                      {myPrediction.absError !== null ? Number(myPrediction.absError) : 'n/a'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                      Your points
                    </p>
                    <p className="text-gold font-semibold mt-1">
                      {myPrediction.points !== null ? Number(myPrediction.points) : 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                      Your rank
                    </p>
                    <p className="text-[var(--fg)] font-semibold mt-1">
                      {myPrediction.rank !== null ? `#${myPrediction.rank}` : 'n/a'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--fg-muted)]">You did not enter this one.</p>
              )}
            </div>
          </section>
        )}

        {resolved && topTen.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.25em] text-[var(--fg-muted)] mb-4">
              Top ten
            </h2>
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-subtle)] text-left text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                    <th className="px-4 py-2.5 font-medium">Rank</th>
                    <th className="px-4 py-2.5 font-medium">Reader</th>
                    <th className="px-4 py-2.5 font-medium text-right">Prediction</th>
                    <th className="px-4 py-2.5 font-medium text-right">Error</th>
                    <th className="px-4 py-2.5 font-medium text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {topTen.map((row) => (
                    <tr
                      key={`${row.rank}-${row.user.id}`}
                      className={`border-t border-[var(--border)] ${row.user.id === user.id ? 'bg-gold/5' : 'bg-[var(--bg-elevated)]'}`}
                    >
                      <td className="px-4 py-2.5 tabular-nums text-[var(--fg-muted)]">
                        #{row.rank}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--fg)]">
                        {displayAuthorName(row.user.name) || 'Reader'}
                        {row.user.id === user.id && (
                          <span className="text-gold text-xs ml-2">(you)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg)]">
                        {Number(row.value)} {event.unitLabel}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-muted)]">
                        {row.absError !== null ? Number(row.absError) : 'n/a'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gold">
                        {row.points !== null ? Number(row.points) : 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {showField && state !== 'Cancelled' && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.25em] text-[var(--fg-muted)] mb-4">
              How the field called it
            </h2>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-6">
              <DistributionBars
                values={allValues.map((p) => Number(p.value))}
                unitLabel={event.unitLabel}
                actualValue={resolved ? Number(event.actualValue) : null}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
