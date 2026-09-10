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
    return { response: apiError('Article not found.', 404, 'NOT_FOUND') } as const
  }
  if (
    user.role === 'EDITOR' &&
    !(await editorCanAccessArticleCategory(user.id, article.categoryId))
  ) {
    return {
      response: apiError(
        'This article is outside your assigned categories.',
        403,
        'CATEGORY_SCOPE_DENIED'
      ),
    } as const
  }
  return { article } as const
}

export async function POST(_req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user
  const { id } = await params
  const access = await authorizeArticle(user, id)
  if ('response' in access) return access.response
  if (access.article.status !== 'PUBLISHED') {
    return apiError('Only published articles can be pinned.', 400, 'INVALID_ARTICLE_STATUS')
  }
  await prisma.article.update({ where: { id }, data: { isPinned: true } })
  revalidateArticleLists()
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user
  const { id } = await params
  const access = await authorizeArticle(user, id)
  if ('response' in access) return access.response
  await prisma.article.update({ where: { id }, data: { isPinned: false } })
  revalidateArticleLists()
  return NextResponse.json({ ok: true })
}
