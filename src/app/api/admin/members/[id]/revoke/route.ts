import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { MembershipError, resolveMembershipId, revokeMember } from '@/lib/membership'

interface Ctx {
  params: Promise<{ id: string }>
}

/**
 * POST /api/admin/members/:id/revoke  { hideProfile?: boolean }
 * Withdraws application access. Nothing is deleted. `hideProfile` is the separate
 * decision about the public card; it can also be changed later from the member list.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let hideProfile = false
  try {
    const body: unknown = await request.json().catch(() => ({}))
    if (body && typeof body === 'object' && 'hideProfile' in body) {
      if (typeof body.hideProfile !== 'boolean') {
        return NextResponse.json({ error: 'hideProfile must be true or false.', code: 'INVALID_FIELD' }, { status: 400 })
      }
      hideProfile = body.hideProfile
    }
    const { id: ref } = await params
    const id = await resolveMembershipId(ref)
    if (!id) return NextResponse.json({ error: 'Member not found.', code: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ ok: true, ...(await revokeMember(admin, id, { hideProfile })) })
  } catch (error) {
    if (error instanceof MembershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[admin/members] revoke failed', error)
    return NextResponse.json({ error: 'Access could not be revoked.' }, { status: 500 })
  }
}
