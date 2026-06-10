import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { PlusCircle } from 'lucide-react'
import type { Metadata } from 'next'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREDICTIONS_MANAGE_ROLES } from '@/lib/rbac'
import { PredictionEventActions } from '@/components/editorial/PredictionEventActions'

export const metadata: Metadata = {
  title: 'Predictions | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const STATUS_BADGES: Record<string, string> = {
  OPEN: 'bg-emerald-500/10 text-emerald-600',
  CLOSED: 'bg-amber-500/10 text-amber-600',
  RESOLVED: 'bg-gold/10 text-gold',
  CANCELLED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
}

export default async function PredictionsAdminPage() {
  // Role gate: re-verified against the database, never trusted from the JWT.
  // The allowed roles live in PREDICTIONS_MANAGE_ROLES in src/lib/rbac.ts.
  const user = await getVerifiedSessionUser(PREDICTIONS_MANAGE_ROLES)
  if (!user) notFound()

  const events = await prisma.predictionEvent.findMany({
    orderBy: { deadline: 'desc' },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      unitLabel: true,
      fredSeriesId: true,
      deadline: true,
      releaseDate: true,
      actualValue: true,
      semesterKey: true,
      _count: { select: { predictions: true } },
    },
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 sm:mb-8 pl-10 md:pl-0">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            Predictions
          </h1>
          <p className="text-[var(--fg-faint)] text-sm mt-1">
            {events.length} event{events.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <Link
          href="/editorial/predictions/new"
          className="flex items-center gap-2 bg-navy text-cream text-xs font-bold uppercase tracking-widest px-3 sm:px-5 py-2.5 hover:bg-navy/90 transition-colors min-h-[44px]"
        >
          <PlusCircle size={14} />
          <span className="hidden sm:inline">New Event</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-[var(--fg-faint)] border border-dashed border-[var(--border)] rounded-lg p-8 text-center">
          No prediction events yet. Create the first one ahead of the next rate decision or CPI
          print.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest ${STATUS_BADGES[event.status]}`}
                    >
                      {event.status}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                      {event.type} · {event.semesterKey}
                      {event.fredSeriesId ? ` · FRED ${event.fredSeriesId}` : ' · manual resolve'}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-[var(--fg)] mt-1.5">
                    <Link href={`/predictions/${event.id}`} className="hover:text-gold transition-colors">
                      {event.title}
                    </Link>
                  </h2>
                  <p className="text-xs text-[var(--fg-muted)] mt-1.5">
                    Deadline {format(event.deadline, 'd MMM yyyy, HH:mm')} · release{' '}
                    {format(event.releaseDate, 'd MMM yyyy')} · {event._count.predictions}{' '}
                    {event._count.predictions === 1 ? 'entry' : 'entries'}
                    {event.actualValue !== null
                      ? ` · actual ${Number(event.actualValue)} ${event.unitLabel}`
                      : ''}
                  </p>
                </div>
                <PredictionEventActions
                  eventId={event.id}
                  status={event.status}
                  unitLabel={event.unitLabel}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
