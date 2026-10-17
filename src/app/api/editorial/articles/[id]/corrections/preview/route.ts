import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CORRECTION_PREPARE_ROLES } from '@/lib/rbac'
import { apiError } from '@/lib/apiResponse'
import { renderContent } from '@/lib/articleRender'
import { loadArticleForCorrections } from '@/lib/corrections/service'
import { CORRECTION_LIMITS } from '@/lib/corrections/types'
import { correctionErrorResponse, readJson } from '@/lib/corrections/http'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * POST { content }: the article body rendered exactly as the public page renders it (same renderer,
 * same sanitiser), so the preview shows what readers will see. Read-only: nothing is stored.
 */
export async function POST(req: Request, { params }: Props) {
  const requestId = crypto.randomUUID()
  try {
    const auth = await requireVerifiedSessionUser(CORRECTION_PREPARE_ROLES)
    if (!auth.ok) return auth.response
    const { id } = await params
    await loadArticleForCorrections(prisma, auth.user, id)
    const body = (await readJson(req)) as { content?: unknown } | null
    if (typeof body?.content !== 'string' || body.content.length > CORRECTION_LIMITS.content) {
      return apiError('The article text to preview is missing or too long.', 400, 'VALIDATION_ERROR', requestId)
    }
    const { html, footnotes } = renderContent(body.content)
    return NextResponse.json({ html, footnotes }, { headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } })
  } catch (error) {
    return correctionErrorResponse(error, requestId, 'api/editorial/corrections:preview')
  }
}
