import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { apiServerErrorResponse } from '@/lib/apiResponse'
import { DebateLifecycleError, isDebateAction, transitionDebate } from '@/lib/debateLifecycle'

interface Props {
  params: Promise<{ debateId: string }>
}

/**
 * POST { action, expectedUpdatedAt?, confirmTitle? }
 * unpublish | publish | delete | restore | purge. Administrators only, checked here on
 * the server against the database role: hiding a button is not the boundary.
 */
async function POSTHandler(req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response

  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { action, expectedUpdatedAt, confirmTitle } = body as Record<string, unknown>
  if (!isDebateAction(action)) {
    return NextResponse.json({ error: 'Unknown debate action.' }, { status: 400 })
  }
  if (
    (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string') ||
    (confirmTitle !== undefined && typeof confirmTitle !== 'string')
  ) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { debateId } = await params
  try {
    const result = await transitionDebate(auth.user, debateId, action, {
      expectedUpdatedAt: expectedUpdatedAt as string | undefined,
      confirmTitle: confirmTitle as string | undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof DebateLifecycleError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    return apiServerErrorResponse(error, {
      operation: `debate:${action}`,
      userMessage: 'The debate could not be changed. Nothing was modified. Try again.',
      code: 'DEBATE_LIFECYCLE_FAILED',
    })
  }
}

export const POST = withTestingAudit(POSTHandler)
