import { getServerSession } from 'next-auth'
import type { NextRequest } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireTestingWorkspace } from '@/lib/testingMode'

/**
 * The REAL, current administrator behind a request to a testing endpoint, or null.
 *
 * - The exact Origin is required for anything that changes state, so a cross-site page cannot start or alter
 *   testing. A read-only caller passes `requireOrigin: false`; a foreign Origin is still refused.
 * - The workspace must be verified (throws otherwise: the caller turns that into "unavailable").
 * - While a persona session is active the session's user is the persona, so the administrator
 *   is read from the testing capability. They must still be an active, verified ADMIN right now.
 */
export async function realAdministrator(request: NextRequest, options: { requireOrigin?: boolean } = {}) {
  // State-changing calls must present the exact site Origin. A read-only call may omit it: browsers do not
  // send Origin on same-origin GETs, and the response is only ever readable by the signed-in administrator.
  const origin = request.headers.get('origin')
  const sameOrigin = origin === new URL(process.env.NEXTAUTH_URL ?? request.url).origin
  if (options.requireOrigin !== false ? !sameOrigin : origin !== null && !sameOrigin) return null
  await requireTestingWorkspace()
  const session = await getServerSession(authOptions)
  const id = session?.testing?.administratorId ?? session?.user.id
  if (!id) return null
  const user = await prisma.user.findUnique({ where: { id } })
  return user?.role === 'ADMIN' && user.isActive && !user.isBanned && user.emailVerified ? user : null
}
