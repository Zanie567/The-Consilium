import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TEAM_PROFILE_ROLES } from '@/lib/teamProfiles'

/** Admin-authorised ownership is independent of public appointment. */

export type LinkTarget =
  | { ok: true; userId: string | null | undefined }
  | { ok: false; response: NextResponse }

/**
 * Parses the admin-only `userId` of a card. `undefined` (absent) leaves the link
 * alone, `null` or `''` unlinks, and a string links the card to that account after
 * checking it exists and can be on a team. One card per account is the database's
 * job (unique `userId`); a clash surfaces as a unique violation for the caller.
 */
export async function parseLinkTarget(value: unknown): Promise<LinkTarget> {
  if (value === undefined) return { ok: true, userId: undefined }
  if (value === null || value === '') return { ok: true, userId: null }
  if (typeof value !== 'string') {
    return { ok: false, response: NextResponse.json({ error: 'userId must be a string' }, { status: 400 }) }
  }
  const account = await prisma.user.findUnique({
    where: { id: value },
    select: { role: true, isActive: true, isBanned: true },
  })
  if (!account || !account.isActive || account.isBanned || !TEAM_PROFILE_ROLES.includes(account.role as typeof TEAM_PROFILE_ROLES[number])) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'That account does not exist, is inactive, or is not a Admin, Writer, Editor or Growth account.' },
        { status: 400 },
      ),
    }
  }
  return { ok: true, userId: value }
}
