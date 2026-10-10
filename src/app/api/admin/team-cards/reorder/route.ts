import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { reorderCards } from '@/lib/teamCards'
import { readJsonObject, teamCardErrorResponse } from '@/lib/teamCardRoutes'

// POST { ids: string[] }: the given cards take the order of the list. Administrators only.
async function POSTHandler(request: Request) {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response
  const body = await readJsonObject(request)
  try {
    await reorderCards(auth.user, body?.ids as string[])
    return NextResponse.json({ ok: true })
  } catch (error) {
    return teamCardErrorResponse(error, 'team-card:reorder')
  }
}

export const POST = withTestingAudit(POSTHandler)
