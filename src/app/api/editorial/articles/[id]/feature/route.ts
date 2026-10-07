import { articleRevisionError } from '@/lib/articleRevision'
import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser, type VerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { editorCanAccessArticleCategory } from '@/lib/articleCategoryAccess'
import { apiError, articleMutationErrorResponse } from '@/lib/apiResponse'
import { revalidateArticleLists } from '@/lib/revalidateArticles'

interface Props {
  params: Promise<{ id: string }>
}

async function authorizeArticle(user: VerifiedSessionUser, id: string) {
  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, status: true, categoryId: true, deletedAt: true, updatedAt: true },
  })
  if (!article || article.deletedAt) {
    return { ok: false, response: apiError('Article not found.', 404, 'NOT_FOUND') } as const
  }
  if (
    user.role === 'EDITOR' &&
    !(await editorCanAccessArticleCategory(user.id, article.categoryId))
  ) {
    return {
      ok: false,
      response: apiError(
        'This article is outside your assigned categories.',
        403,
        'CATEGORY_SCOPE_DENIED'
      ),
    } as const
  }
  return { ok: true, article } as const
}

async function POSTHandler(_req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  const { id } = await params
  const access = await authorizeArticle(user, id)
  if (!access.ok) return access.response
  const revisionError = articleRevisionError(_req.headers.get('x-article-revision') ?? undefined, access.article.updatedAt)
  if (revisionError) return revisionError
  if (access.article.status !== 'PUBLISHED') {
    return apiError('Only published articles can be featured.', 400, 'INVALID_ARTICLE_STATUS')
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Selecting one homepage feature is a global operation. Serialize choices
      // before locking their different target rows, preserving the single slot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'consilium:featured-article'}))`
      const saved = await tx.article.update({
        where: { id, updatedAt: access.article.updatedAt, deletedAt: null, status: 'PUBLISHED', categoryId: access.article.categoryId },
        data: { isFeatured: true },
      })
      await tx.article.updateMany({ where: { id: { not: id }, isFeatured: true }, data: { isFeatured: false } })
      return saved
    })
    revalidateArticleLists()
    return NextResponse.json({ ok: true, updatedAt: updated.updatedAt })
  } catch (error) {
    return articleMutationErrorResponse(error, 'update', crypto.randomUUID())
  }
}

async function DELETEHandler(_req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  const { id } = await params
  const access = await authorizeArticle(user, id)
  if (!access.ok) return access.response
  const revisionError = articleRevisionError(_req.headers.get('x-article-revision') ?? undefined, access.article.updatedAt)
  if (revisionError) return revisionError
  try {
    const updated = await prisma.article.update({ where: { id, updatedAt: access.article.updatedAt, deletedAt: null, categoryId: access.article.categoryId }, data: { isFeatured: false } })
    revalidateArticleLists()
    return NextResponse.json({ ok: true, updatedAt: updated.updatedAt })
  } catch (error) {
    return articleMutationErrorResponse(error, 'update', crypto.randomUUID())
  }
}

export const POST = withTestingAudit(POSTHandler)

export const DELETE = withTestingAudit(DELETEHandler)
