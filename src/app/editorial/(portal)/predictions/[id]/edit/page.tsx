import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREDICTIONS_MANAGE_ROLES } from '@/lib/rbac'
import { PredictionEventForm } from '@/components/editorial/PredictionEventForm'

export const metadata: Metadata = {
  title: 'Edit Prediction Event | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditPredictionEventPage({ params }: Props) {
  // Role gate: re-verified against the database, never trusted from the JWT.
  // The allowed roles live in PREDICTIONS_MANAGE_ROLES in src/lib/rbac.ts.
  const user = await getVerifiedSessionUser(PREDICTIONS_MANAGE_ROLES)
  if (!user) notFound()

  const { id } = await params
  const event = await prisma.predictionEvent.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      fredSeriesId: true,
      unitLabel: true,
      deadline: true,
      releaseDate: true,
      minValue: true,
      maxValue: true,
      maxError: true,
      status: true,
    },
  })
  if (!event) notFound()

  if (event.status === 'RESOLVED' || event.status === 'CANCELLED') {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
        <div className="pl-10 md:pl-0">
          <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            Edit Prediction Event
          </h1>
          <p className="text-[var(--fg-muted)] text-sm mt-3">
            This event is {event.status.toLowerCase()} and can no longer be edited.
          </p>
        </div>
      </div>
    )
  }

  // datetime-local inputs want local wall clock time without a timezone
  // suffix; format() renders in the server's zone, which matches how the
  // dates were entered for a single-admin workflow.
  const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
          Edit Prediction Event
        </h1>
        <p className="text-[var(--fg-faint)] text-sm mt-1">{event.title}</p>
      </div>
      <PredictionEventForm
        eventId={event.id}
        initialValues={{
          title: event.title,
          description: event.description ?? '',
          type: event.type,
          fredSeriesId: event.fredSeriesId ?? '',
          unitLabel: event.unitLabel,
          deadline: toLocalInput(event.deadline),
          releaseDate: toLocalInput(event.releaseDate),
          minValue: String(Number(event.minValue)),
          maxValue: String(Number(event.maxValue)),
          maxError: String(Number(event.maxError)),
        }}
      />
    </div>
  )
}
