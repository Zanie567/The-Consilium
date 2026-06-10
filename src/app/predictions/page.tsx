import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requirePredictionsAccess } from '@/lib/predictionsAccess'
import { isClosedForSubmissions } from '@/lib/predictions'
import { CountdownTimer } from '@/components/predictions/CountdownTimer'
import { EVENT_TYPE_LABELS, eventDisplayState, STATE_BADGE_CLASSES } from './shared'

export const metadata: Metadata = {
  title: 'Predictions League',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function PredictionsPage() {
  const user = await requirePredictionsAccess('/predictions')

  const [events, myPredictions] = await Promise.all([
    prisma.predictionEvent.findMany({
      where: { status: { not: 'CANCELLED' } },
      orderBy: [{ deadline: 'desc' }],
      take: 30,
      select: {
        id: true,
        title: true,
        type: true,
        unitLabel: true,
        deadline: true,
        releaseDate: true,
        status: true,
        actualValue: true,
        _count: { select: { predictions: true } },
      },
    }),
    prisma.prediction.findMany({
      where: { userId: user.id },
      select: { eventId: true, value: true, points: true },
    }),
  ])

  const mine = new Map(myPredictions.map((p) => [p.eventId, p]))
  const now = new Date()
  const open = events.filter((e) => !isClosedForSubmissions(e, now))
  const rest = events.filter((e) => isClosedForSubmissions(e, now))

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">Reader League</p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-gold"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Predictions
        </h1>
        <p className="text-cream/50 text-sm mt-4 max-w-xl mx-auto">
          Call the next UK macro releases before they land. Closest predictions take the points,
          and points build your semester ranking.
        </p>
        <Link
          href="/predictions/leaderboard"
          className="inline-block mt-6 text-gold/80 hover:text-gold text-xs tracking-widest uppercase transition-colors"
        >
          View leaderboard →
        </Link>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-12">
        <section>
          <h2 className="text-xs uppercase tracking-[0.25em] text-[var(--fg-muted)] mb-4">
            Open for predictions
          </h2>
          {open.length === 0 ? (
            <p className="text-sm text-[var(--fg-faint)] border border-dashed border-[var(--border)] rounded-lg p-6 text-center">
              Nothing is open right now. New events appear here ahead of each release.
            </p>
          ) : (
            <ul className="space-y-3">
              {open.map((event) => {
                const my = mine.get(event.id)
                return (
                  <li key={event.id}>
                    <Link
                      href={`/predictions/${event.id}`}
                      className="block rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5 hover:border-gold/60 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                            {EVENT_TYPE_LABELS[event.type]}
                          </span>
                          <h3 className="text-lg font-semibold text-[var(--fg)] mt-1">
                            {event.title}
                          </h3>
                          <p className="text-xs text-[var(--fg-muted)] mt-2">
                            {my
                              ? `Your prediction: ${Number(my.value)} ${event.unitLabel}`
                              : 'You have not predicted yet'}
                            {' · '}
                            {event._count.predictions}{' '}
                            {event._count.predictions === 1 ? 'entry' : 'entries'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                            Closes in
                          </p>
                          <p className="text-sm font-semibold text-gold mt-1">
                            <CountdownTimer deadline={event.deadline.toISOString()} />
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-[0.25em] text-[var(--fg-muted)] mb-4">
            Recent events
          </h2>
          {rest.length === 0 ? (
            <p className="text-sm text-[var(--fg-faint)]">No past events yet.</p>
          ) : (
            <ul className="space-y-3">
              {rest.map((event) => {
                const my = mine.get(event.id)
                const state = eventDisplayState(event, now)
                return (
                  <li key={event.id}>
                    <Link
                      href={`/predictions/${event.id}`}
                      className="block rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5 hover:border-gold/60 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                            {EVENT_TYPE_LABELS[event.type]} · {format(event.releaseDate, 'd MMM yyyy')}
                          </span>
                          <h3 className="text-lg font-semibold text-[var(--fg)] mt-1">
                            {event.title}
                          </h3>
                          <p className="text-xs text-[var(--fg-muted)] mt-2">
                            {event.status === 'RESOLVED' && event.actualValue !== null
                              ? `Actual: ${Number(event.actualValue)} ${event.unitLabel}`
                              : 'Result pending'}
                            {my ? ` · You predicted ${Number(my.value)} ${event.unitLabel}` : ''}
                            {my?.points !== null && my?.points !== undefined
                              ? ` · ${Number(my.points)} pts`
                              : ''}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-[10px] uppercase tracking-widest ${STATE_BADGE_CLASSES[state]}`}
                        >
                          {state}
                        </span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
