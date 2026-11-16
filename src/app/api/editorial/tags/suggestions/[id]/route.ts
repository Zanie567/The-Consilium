import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TAG_MANAGE_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { reviewSuggestion, type SuggestionDecision } from '@/lib/tags/manage'
import { invalidBody, readJsonObject, tagRouteError } from '@/lib/tags/api'

/**
 * PATCH { action: 'approve', name? } | { action: 'alias', tagId } | { action: 'reject', reason? }.
 * Tag managers only.
 */
async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  let decision: SuggestionDecision
  if (body.action === 'approve') decision = { action: 'approve', name: body.name }
  else if (body.action === 'alias' && typeof body.tagId === 'string' && body.tagId) decision = { action: 'alias', tagId: body.tagId }
  else if (body.action === 'reject') decision = { action: 'reject', reason: body.reason }
  else return invalidBody()
  try {
    return NextResponse.json(await reviewSuggestion(prisma, id, decision, auth.user.id))
  } catch (error) {
    return tagRouteError(error, 'review')
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
