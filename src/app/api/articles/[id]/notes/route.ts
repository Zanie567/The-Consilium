import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { editorCanAccessCategory } from '@/lib/articleCategoryScope'
import { apiError } from '@/lib/apiResponse'

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

  const { id } = await params
  const { content, isPrivate } = await req.json()
  if (!content?.trim()) {
    return NextResponse.json({ error: 'Content required' }, { status: 400 })
  }

  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, categoryId: true },
  })
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  }

  if (user.role === 'EDITOR') {
    const scope = await loadEditorCategoryScope(user.id)
    if (!editorCanAccessCategory(scope, article.categoryId)) {
      return apiError(
        'This article is outside your assigned categories.',
        403,
        'CATEGORY_SCOPE_DENIED'
      )
    }
  }

  const note = await prisma.articleNote.create({
    data: {
      articleId: article.id,
      authorId: user.id,
      content: content.trim(),
      isPrivate: isPrivate ?? false,
    },
    include: { author: { select: { name: true } } },
  })

  return NextResponse.json(note, { status: 201 })
}
