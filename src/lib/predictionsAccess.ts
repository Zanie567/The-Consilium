import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions, getVerifiedSessionUser } from './auth'
import { PREDICTIONS_ACCESS_ROLES } from './rbac'

/**
 * Server-side access check for the public predictions pages.
 *
 * Signed-out visitors get the site's normal login redirect with a callback to
 * the page they wanted. Signed-in users outside PREDICTIONS_ACCESS_ROLES (in
 * src/lib/rbac.ts, the single place that controls who can see the league) get
 * a 404 so the feature stays invisible during the admin-only trial.
 */
export async function requirePredictionsAccess(callbackPath: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`)
  }
  // Role re-verified against the database, never trusted from the JWT.
  const user = await getVerifiedSessionUser(PREDICTIONS_ACCESS_ROLES)
  if (!user) notFound()
  return user
}
