import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getVerifiedSessionUser } from '@/lib/auth'
import { PREDICTIONS_MANAGE_ROLES } from '@/lib/rbac'
import { PredictionEventForm } from '@/components/editorial/PredictionEventForm'

export const metadata: Metadata = {
  title: 'New Prediction Event | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function NewPredictionEventPage() {
  // Role gate: re-verified against the database, never trusted from the JWT.
  // The allowed roles live in PREDICTIONS_MANAGE_ROLES in src/lib/rbac.ts.
  const user = await getVerifiedSessionUser(PREDICTIONS_MANAGE_ROLES)
  if (!user) notFound()

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
          New Prediction Event
        </h1>
        <p className="text-[var(--fg-faint)] text-sm mt-1">
          Set up the next release for readers to call.
        </p>
      </div>
      <PredictionEventForm />
    </div>
  )
}
