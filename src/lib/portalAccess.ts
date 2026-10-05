import { notFound, redirect } from 'next/navigation'
import { getServerSession, type Session } from 'next-auth'
import type { Role } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { EDITORIAL_PORTAL_ROLES } from '@/lib/rbac'

/**
 * A positive role guard for portal pages that read protected data on the server.
 *
 * Pages used to exclude one role (`if (role === 'GROWTH') redirect(...)`) and treat everyone else as
 * staff, so a reader, or an account restricted since its cookie was issued, fell through to the
 * database queries. The portal LAYOUT shows "Access Denied" to such accounts, but a layout does not
 * stop its page from running: the page's data was still serialised into the response.
 *
 * Signed out -> sign in. A staff role that is not allowed on this page -> back to the dashboard.
 * Anyone else (reader, banned, inactive, deleted: session.user.role reads as READER) -> 404, before
 * any query runs. The session role itself is read from the database (see authOptions.callbacks.session).
 */
export async function requirePortalRole(allowed: readonly Role[]): Promise<Session & { user: { id: string; role: Role } }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/editorial/login')
  const role = session.user.role as Role
  if (!EDITORIAL_PORTAL_ROLES.includes(role as (typeof EDITORIAL_PORTAL_ROLES)[number])) notFound()
  if (!allowed.includes(role)) redirect('/editorial')
  return session as Session & { user: { id: string; role: Role } }
}
