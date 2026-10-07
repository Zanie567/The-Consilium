import { articleRevisionError } from '@/lib/articleRevision'
import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { editorCanAccessArticleCategory } from '@/lib/articleCategoryAccess'
import { apiError, articleMutationErrorResponse } from '@/lib/apiResponse'

interface Props {
  params: Promise<{ id: string }>
}

const MAX_LENGTH = 200

/**
 * PATCH /api/editorial/articles/[id]/commendation
 *
 * Sets or clears an article's editorial commendation. EDITOR or ADMIN only.
 * Body: { commendation: string | null }. A string is trimmed and must be at
 * most 200 characters; null or an empty string clears the commendation.
 */
async function PATCHHandler(req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  const { id } = await params

  let expectedUpdatedAt: unknown
  let commendation: string | null
  try {
    const body = (await req.json()) as { commendation: unknown; expectedUpdatedAt?: unknown }
    expectedUpdatedAt = body.expectedUpdatedAt
    const raw = body.commendation
    if (raw === null) {
      commendation = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > MAX_LENGTH) {
        return NextResponse.json(
          { error: `Commendation must be ${MAX_LENGTH} characters or fewer.` },
          { status: 400 }
        )
      }
      commendation = trimmed.length === 0 ? null : trimmed
    } else {
      return NextResponse.json({ error: 'commendation must be a string or null' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const article = await prisma.article.findUnique({
      where: { id },
      select: { id: true, categoryId: true, deletedAt: true, updatedAt: true },
    })
    if (!article || article.deletedAt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (
      user.role === 'EDITOR' &&
      !(await editorCanAccessArticleCategory(user.id, article.categoryId))
    ) {
      return apiError(
        'This article is outside your assigned categories.',
        403,
        'CATEGORY_SCOPE_DENIED'
      )
    }

    const revisionError = articleRevisionError(expectedUpdatedAt, article.updatedAt)
    if (revisionError) return revisionError

    const updated = await prisma.article.update({
      where: { id, updatedAt: article.updatedAt, deletedAt: null, categoryId: article.categoryId },
      data: { editorialCommendation: commendation },
      select: { id: true, editorialCommendation: true, updatedAt: true },
    })

    return NextResponse.json({
      updatedAt: updated.updatedAt,
      id: updated.id,
      editorialCommendation: updated.editorialCommendation,
    })
  } catch (err) {
    console.error('[editorial/commendation] Error:', err instanceof Error ? err.message : String(err))
    return articleMutationErrorResponse(err, 'update', crypto.randomUUID())
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
