import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser, type VerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { editorCanAccessArticleCategory } from '@/lib/articleCategoryAccess'
import { apiError } from '@/lib/apiResponse'
import { revalidateArticleLists } from '@/lib/revalidateArticles'

interface Props {
  params: Promise<{ id: string }>
}

async function authorizeArticle(user: VerifiedSessionUser, id: string) {
  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, status: true, categoryId: true, deletedAt: true },
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
  if (access.article.status !== 'PUBLISHED') {
    return apiError('Only published articles can be featured.', 400, 'INVALID_ARTICLE_STATUS')
  }

  // Remove featured from all others, set on this one
  await prisma.$transaction([
    prisma.article.updateMany({ data: { isFeatured: false } }),
    prisma.article.update({ where: { id }, data: { isFeatured: true } }),
  ])
  revalidateArticleLists()

  return NextResponse.json({ ok: true })
}

async function DELETEHandler(_req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  const { id } = await params
  const access = await authorizeArticle(user, id)
  if (!access.ok) return access.response
  await prisma.article.update({ where: { id }, data: { isFeatured: false } })
  revalidateArticleLists()
  return NextResponse.json({ ok: true })
}

export const POST = withTestingAudit(POSTHandler)

export const DELETE = withTestingAudit(DELETEHandler)
