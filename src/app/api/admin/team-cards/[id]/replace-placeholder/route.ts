import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { replacePlaceholderWithCard } from '@/lib/teamCards'
import { readJsonObject, teamCardErrorResponse } from '@/lib/teamCardRoutes'

interface Props {
  params: Promise<{ id: string }>
}

// POST { userId, placeholderId, expectedUpdatedAt, expectedPlaceholderUpdatedAt }: the card in the path is the
// existing profile to link; the account's auto-generated placeholder is removed in the same transaction, and only
// if it is provably disposable. Administrators only. Nothing on the chosen profile changes except its owner.
async function POSTHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const userId = text(body?.userId), placeholderId = text(body?.placeholderId)
  const expectedTarget = text(body?.expectedUpdatedAt), expectedPlaceholder = text(body?.expectedPlaceholderUpdatedAt)
  if (!userId || !placeholderId || !expectedTarget || !expectedPlaceholder) {
    return NextResponse.json({ error: 'Choose the account, its placeholder and the profile to link, then confirm.', code: 'INVALID_FIELD' }, { status: 400 })
  }
  const { id } = await params
  try {
    const result = await replacePlaceholderWithCard(auth.user, { userId, placeholderId, targetId: id, expectedPlaceholderUpdatedAt: expectedPlaceholder, expectedTargetUpdatedAt: expectedTarget })
    return NextResponse.json(result)
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:replace-placeholder')
  }
}

export const POST = withTestingAudit(POSTHandler)
