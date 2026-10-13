import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { linkCardToAccount, unlinkCard } from '@/lib/teamCards'
import { readJsonObject, teamCardErrorResponse } from '@/lib/teamCardRoutes'

interface Props {
  params: Promise<{ id: string }>
}

// POST { userId, expectedUpdatedAt? } links an existing, unowned card to an account.
// DELETE { expectedUpdatedAt? } unlinks it. Both change ONLY the owner: no profile text,
// photo, title, placement, order or visibility is touched. Administrators only.
async function POSTHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  if (!body || typeof body.userId !== 'string' || !body.userId) {
    return NextResponse.json({ error: 'Choose the account to link.', code: 'INVALID_FIELD' }, { status: 400 })
  }
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== 'string') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { id } = await params
  try {
    const result = await linkCardToAccount(auth.user, id, body.userId, { expectedUpdatedAt: body.expectedUpdatedAt as string | undefined })
    return NextResponse.json(result)
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:link')
  }
}

async function DELETEHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  const { id } = await params
  try {
    const result = await unlinkCard(auth.user, id, { expectedUpdatedAt: typeof body?.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined })
    return NextResponse.json(result)
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:unlink')
  }
}

export const POST = withTestingAudit(POSTHandler)
export const DELETE = withTestingAudit(DELETEHandler)
