import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CORRECTION_PREPARE_ROLES } from '@/lib/rbac'
import { apiError } from '@/lib/apiResponse'
import { withTestingAudit } from '@/lib/testingAudit'
import {
  afterCorrectionPublished,
  publishPendingCorrection,
  revisePendingCorrection,
  withdrawPendingCorrection,
} from '@/lib/corrections/service'
import { parseCorrectionDraft, parseRevision, parseWithdrawReason } from '@/lib/corrections/validation'
import { correctionErrorResponse, readJson } from '@/lib/corrections/http'

interface Props {
  params: Promise<{ id: string; correctionId: string }>
}

/**
 * PATCH a PENDING correction. Every action echoes the correction's `expectedUpdatedAt`, so nobody
 * approves or withdraws a version they have not seen.
 *   { action: 'publish', confirm: true }   administrators: amend the article and publish the notice
 *   { action: 'revise', ...fields }        the preparer or an administrator: replace the draft
 *   { action: 'withdraw', reason }         the preparer or an administrator: never published, kept for audit
 * There is deliberately no way to change or delete a PUBLISHED correction (the database refuses it too):
 * a mistake in one is fixed by publishing an amendment (POST with supersedesId).
 */
async function PATCHHandler(req: Request, { params }: Props) {
  const requestId = crypto.randomUUID()
  try {
    const auth = await requireVerifiedSessionUser(CORRECTION_PREPARE_ROLES)
    if (!auth.ok) return auth.response
    const { id: articleId, correctionId } = await params
    const body = (await readJson(req)) as Record<string, unknown> | null
    const expectedUpdatedAt = parseRevision(body?.expectedUpdatedAt)
    if (!expectedUpdatedAt) return apiError('This form does not say which version of the correction it shows. Reload and try again.', 400, 'VALIDATION_ERROR', requestId)

    // The URL's article must own the correction (no acting on one article through another's URL).
    const owner = await prisma.articleCorrection.findUnique({ where: { id: correctionId }, select: { articleId: true } })
    if (!owner || owner.articleId !== articleId) return apiError('This correction no longer exists.', 404, 'NOT_FOUND', requestId)

    switch (body?.action) {
      case 'publish': {
        if (body.confirm !== true) return apiError('Confirm the publication of this correction before it goes live.', 409, 'PUBLICATION_CONFIRMATION_REQUIRED', requestId)
        const result = await publishPendingCorrection(prisma, auth.user, correctionId, { expectedUpdatedAt, requestId })
        const warnings = await afterCorrectionPublished(prisma, auth.user, result)
        return NextResponse.json({ correction: result.correction, published: true, replayed: false, warnings }, { headers: { 'x-request-id': requestId } })
      }
      case 'revise': {
        const draft = parseCorrectionDraft(body)
        if (!draft.ok) return apiError(draft.error, 400, 'VALIDATION_ERROR', requestId)
        const correction = await revisePendingCorrection(prisma, auth.user, correctionId, draft.value, { expectedUpdatedAt, requestId })
        return NextResponse.json({ correction, published: false, replayed: false, warnings: [] }, { headers: { 'x-request-id': requestId } })
      }
      case 'withdraw': {
        const reason = parseWithdrawReason(body.reason)
        if (!reason.ok) return apiError(reason.error, 400, 'VALIDATION_ERROR', requestId)
        const correction = await withdrawPendingCorrection(prisma, auth.user, correctionId, reason.value, { expectedUpdatedAt, requestId })
        return NextResponse.json({ correction, published: false, replayed: false, warnings: [] }, { headers: { 'x-request-id': requestId } })
      }
      default:
        return apiError('Unknown action.', 400, 'VALIDATION_ERROR', requestId)
    }
  } catch (error) {
    return correctionErrorResponse(error, requestId, 'api/editorial/corrections:update')
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
