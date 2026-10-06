import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { MembershipError, reinstateMember } from '@/lib/membership'

interface Ctx {
  params: Promise<{ id: string }>
}

/** POST /api/admin/members/:id/reinstate  { role }: re-open a revoked member. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body: unknown = await request.json().catch(() => ({}))
    const role = body && typeof body === 'object' && 'role' in body ? body.role : undefined
    const { id } = await params
    return NextResponse.json({ ok: true, ...(await reinstateMember(admin, id, role)) })
  } catch (error) {
    if (error instanceof MembershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[admin/members] reinstate failed', error)
    return NextResponse.json({ error: 'The member could not be reinstated.' }, { status: 500 })
  }
}
