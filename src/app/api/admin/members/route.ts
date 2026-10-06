import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { MembershipError, inviteMember, listMembers } from '@/lib/membership'
import { memberInvitedEmail, roleChangedEmail, sendEmail } from '@/lib/email'
import { prisma } from '@/lib/prisma'

// Admin-only. The caller's role is re-read from the database by
// getVerifiedSessionUser; a role in the request body is only ever a value being
// ASSIGNED to someone else, and is validated against the assignable list.

const INVITE_KEYS = new Set(['email', 'role', 'displayName', 'position', 'publicTier'])

export async function GET() {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await listMembers())
}

export async function POST(request: NextRequest) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'The request body must be a JSON object.' }, { status: 400 })
  }
  const unknownKeys = Object.keys(body).filter((key) => !INVITE_KEYS.has(key))
  if (unknownKeys.length > 0) {
    return NextResponse.json({ error: `Unknown field: ${unknownKeys.join(', ')}.`, code: 'INVALID_FIELD' }, { status: 400 })
  }

  try {
    const result = await inviteMember(admin, {
      email: typeof body.email === 'string' ? body.email : '',
      role: body.role,
      displayName: body.displayName,
      position: body.position,
      publicTier: body.publicTier,
    })

    // Tell the person, best effort: a mail failure must not undo the authorisation.
    if (result.outcome === 'activated') {
      const account = await prisma.user.findUnique({ where: { id: result.membership.userId! }, select: { name: true, email: true } })
      if (account) sendEmail({ to: account.email, ...roleChangedEmail(account.name, result.membership.role, true) }).catch(() => {})
    } else {
      const name = typeof body.displayName === 'string' ? body.displayName : null
      sendEmail({ to: result.membership.email, ...memberInvitedEmail(name, result.membership.role) }).catch(() => {})
    }

    return NextResponse.json(result, { status: result.outcome === 'invited' ? 201 : 200 })
  } catch (error) {
    if (error instanceof MembershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[admin/members] invite failed', error)
    return NextResponse.json({ error: 'The invitation could not be saved.' }, { status: 500 })
  }
}
