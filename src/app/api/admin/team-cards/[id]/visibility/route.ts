import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { setCardVisibility } from '@/lib/teamCards'
import { readJsonObject, teamCardErrorResponse } from '@/lib/teamCardRoutes'

interface Props {
  params: Promise<{ id: string }>
}

// POST { visible: boolean, expectedUpdatedAt? } publishes or hides one Meet the Team card. Administrators only.
// It changes ONLY the card's visibility: no profile text, photo, title, placement, order, owner or account role
// is read from the request or written. Publishing a card that could not appear (incomplete, or a deactivated,
// suspended or test account) is refused with the reason.
async function POSTHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  if (!body || typeof body.visible !== 'boolean') {
    return NextResponse.json({ error: 'Say whether the profile should be visible.', code: 'INVALID_FIELD' }, { status: 400 })
  }
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== 'string') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { id } = await params
  try {
    const result = await setCardVisibility(auth.user, id, body.visible, { expectedUpdatedAt: body.expectedUpdatedAt as string | undefined })
    return NextResponse.json(result)
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:visibility')
  }
}

export const POST = withTestingAudit(POSTHandler)
