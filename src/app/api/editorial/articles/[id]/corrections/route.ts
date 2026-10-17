import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CORRECTION_PREPARE_ROLES } from '@/lib/rbac'
import { apiError } from '@/lib/apiResponse'
import { withTestingAudit } from '@/lib/testingAudit'
import {
  afterCorrectionPublished,
  afterCorrectionSubmitted,
  canApproveCorrections,
  loadArticleForCorrections,
  loadCorrectionHistory,
  prepareCorrection,
} from '@/lib/corrections/service'
import { parseCorrectionDraft, parseRequestKey } from '@/lib/corrections/validation'
import { correctionErrorResponse, readJson } from '@/lib/corrections/http'

interface Props {
  params: Promise<{ id: string }>
}

/** GET: the article as it stands, its version fingerprint and its full corrections history (staff only). */
export async function GET(_req: Request, { params }: Props) {
  const requestId = crypto.randomUUID()
  try {
    const auth = await requireVerifiedSessionUser(CORRECTION_PREPARE_ROLES)
    if (!auth.ok) return auth.response
    const { id } = await params
    const { article, version } = await loadArticleForCorrections(prisma, auth.user, id)
    const history = await loadCorrectionHistory(prisma, id)
    return NextResponse.json({
      article: {
        id: article.id, title: article.title, slug: article.slug, excerpt: article.excerpt, content: article.content,
        status: article.status, publishedAt: article.publishedAt, updatedAt: article.updatedAt,
      },
      version,
      viewer: { id: auth.user.id, canApprove: canApproveCorrections(auth.user.role) },
      ...history,
    }, { headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } })
  } catch (error) {
    return correctionErrorResponse(error, requestId, 'api/editorial/corrections:list')
  }
}

/**
 * POST: prepare a correction against the version the editor loaded.
 *   publish: true   approval roles only: amend the article and publish the notice in one transaction
 *   publish: false  save it as PENDING for an administrator to approve
 * `confirm: true` is required for an immediate publication, so a script or a stray request can never
 * publish without the explicit confirmation the editorial UI asks for.
 */
async function POSTHandler(req: Request, { params }: Props) {
  const requestId = crypto.randomUUID()
  try {
    const auth = await requireVerifiedSessionUser(CORRECTION_PREPARE_ROLES)
    if (!auth.ok) return auth.response
    const { id } = await params
    const body = (await readJson(req)) as Record<string, unknown> | null
    const draft = parseCorrectionDraft(body)
    if (!draft.ok) return apiError(draft.error, 400, 'VALIDATION_ERROR', requestId)
    const key = parseRequestKey(body?.requestKey)
    if (!key.ok) return apiError(key.error, 400, 'VALIDATION_ERROR', requestId)
    const publishNow = body?.publish === true
    if (publishNow && body?.confirm !== true) {
      return apiError('Confirm the publication of this correction before it goes live.', 409, 'PUBLICATION_CONFIRMATION_REQUIRED', requestId)
    }

    const result = await prepareCorrection(prisma, auth.user, id, draft.value, { requestKey: key.value, publishNow, requestId })
    const warnings = result.published
      ? await afterCorrectionPublished(prisma, auth.user, result)
      : await afterCorrectionSubmitted(prisma, auth.user, result)

    return NextResponse.json(
      { correction: result.correction, published: result.published, replayed: result.replayed, warnings },
      { status: result.replayed ? 200 : 201, headers: { 'x-request-id': requestId } },
    )
  } catch (error) {
    return correctionErrorResponse(error, requestId, 'api/editorial/corrections:prepare')
  }
}

export const POST = withTestingAudit(POSTHandler)
