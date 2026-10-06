import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import {
  MembershipError,
  inviteMember,
  isAssignableRole,
  resolveMembershipId,
  setMemberRole,
  updateMemberProfileFields,
} from '@/lib/membership'
import { roleChangedEmail, sendEmail } from '@/lib/email'

interface Ctx {
  params: Promise<{ id: string }>
}

const PATCH_KEYS = new Set(['role', 'position', 'publicTier', 'order', 'visible', 'displayName'])
const PROFILE_KEYS = ['position', 'publicTier', 'order', 'visible', 'displayName'] as const

/**
 * PATCH /api/admin/members/:id: change the authorisation role and/or the public
 * organisational fields. The two are separate inputs on purpose: changing `role` never
 * touches position/team/visibility, and changing those never touches permissions.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
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
  const unknownKeys = Object.keys(body).filter((key) => !PATCH_KEYS.has(key))
  if (unknownKeys.length > 0) {
    return NextResponse.json({ error: `Unknown field: ${unknownKeys.join(', ')}.`, code: 'INVALID_FIELD' }, { status: 400 })
  }
  if (body.role !== undefined && !isAssignableRole(body.role)) {
    return NextResponse.json({ error: 'Role must be one of ADMIN, EDITOR, WRITER or GROWTH.', code: 'INVALID_ROLE' }, { status: 400 })
  }

  try {
    const { id: ref } = await params
    const id = await resolveMembershipId(ref)
    if (!id) return NextResponse.json({ error: 'Member not found.', code: 'NOT_FOUND' }, { status: 404 })
    const membership = await prisma.teamMembership.findUniqueOrThrow({ where: { id } })

    if (PROFILE_KEYS.some((key) => body[key] !== undefined)) {
      await updateMemberProfileFields(admin, id, body)
    }

    if (body.role !== undefined && isAssignableRole(body.role)) {
      if (membership.userId) {
        const { oldRole, newRole } = await setMemberRole(admin, membership.userId, body.role)
        if (oldRole !== newRole) {
          const account = await prisma.user.findUnique({ where: { id: membership.userId }, select: { name: true, email: true } })
          if (account) sendEmail({ to: account.email, ...roleChangedEmail(account.name, newRole, oldRole === 'READER') }).catch(() => {})
        }
      } else {
        // Role changed while the invitation is still pending: update the one row.
        await inviteMember(admin, {
          email: membership.email,
          role: body.role,
          displayName: membership.displayName,
          position: membership.publicPosition,
          publicTier: membership.publicTier,
        })
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof MembershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[admin/members] update failed', error)
    return NextResponse.json({ error: 'The change could not be saved.' }, { status: 500 })
  }
}
