import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { articleWhereForEditorScope } from '@/lib/articleCategoryScope'

// GET /api/editorial/trash - list all soft-deleted articles, most recently deleted first
export async function GET() {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user
  const isWriter = user.role === 'WRITER'
  const editorScope = user.role === 'EDITOR'
    ? await loadEditorCategoryScope(user.id)
    : null

  try {
    const articles = await prisma.article.findMany({
      where: {
        deletedAt: { not: null },
        ...(isWriter ? { authorId: user.id } : {}),
        ...(editorScope ? articleWhereForEditorScope(editorScope) : {}),
      },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        deletedAt: true,
        author: { select: { name: true } },
        category: { select: { name: true } },
      },
    })
    return NextResponse.json(articles)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch trash' }, { status: 500 })
  }
}
