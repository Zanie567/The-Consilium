import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ id: string }>
}

// Editors are scoped to their assigned categories. Mirrors the same guard the
// articles/[id] PUT/DELETE and review handlers apply, so a category-restricted
// editor cannot restore or permanently delete articles outside their remit.
async function editorCategoryScope(
  user: { id: string; role: string },
  article: { categoryId: string | null }
): Promise<NextResponse | null> {
  if (user.role !== 'EDITOR') return null
  if (article.categoryId) {
    const assignment = await prisma.categoryEditor.findFirst({
      where: { userId: user.id, categoryId: article.categoryId },
    })
    return assignment ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const anyAssignment = await prisma.categoryEditor.findFirst({ where: { userId: user.id } })
  return anyAssignment ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null
}

// PATCH /api/editorial/trash/[id] - restore a soft-deleted article
export async function PATCH(_req: NextRequest, { params }: Props) {
  const user = await getVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  try {
    const article = await prisma.article.findUnique({ where: { id } })
    if (!article || !article.deletedAt) {
      return NextResponse.json({ error: 'Not found in trash' }, { status: 404 })
    }
    if (user.role === 'WRITER' && article.authorId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const scopeError = await editorCategoryScope(user, article)
    if (scopeError) return scopeError

    const restored = await prisma.article.update({
      where: { id },
      data: { deletedAt: null },
    })
    return NextResponse.json(restored)
  } catch {
    return NextResponse.json({ error: 'Failed to restore article' }, { status: 500 })
  }
}

// DELETE /api/editorial/trash/[id] - permanently delete a trashed article
export async function DELETE(_req: NextRequest, { params }: Props) {
  const user = await getVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  try {
    const article = await prisma.article.findUnique({ where: { id } })
    if (!article || !article.deletedAt) {
      return NextResponse.json({ error: 'Not found in trash' }, { status: 404 })
    }
    if (user.role === 'WRITER' && article.authorId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const scopeError = await editorCategoryScope(user, article)
    if (scopeError) return scopeError

    // Permanently delete + audit atomically so a hard delete is always logged.
    await prisma.$transaction([
      prisma.auditLog.create({
        data: {
          action: 'ARTICLE_HARD_DELETED',
          targetId: id,
          targetType: 'article',
          performedBy: user.id,
          metadata: { title: article.title, authorId: article.authorId },
        },
      }),
      prisma.article.delete({ where: { id } }),
    ])
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to permanently delete article' }, { status: 500 })
  }
}
