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
    const result = await prisma.$transaction(async (tx) => {
      // Re-read + re-authorize against the current row inside the transaction, and
      // make the write state-aware (only a row still in trash flips) so concurrent
      // restores/edits cannot slip between the check and the write.
      const article = await tx.article.findUnique({ where: { id } })
      if (!article || !article.deletedAt) {
        return { error: 'Not found in trash', status: 404 } as const
      }
      if (user.role === 'WRITER' && article.authorId !== user.id) {
        return { error: 'Forbidden', status: 403 } as const
      }
      const scopeError = await editorCategoryScope(user, article)
      if (scopeError) return { scopeError } as const

      const res = await tx.article.updateMany({
        where: { id, deletedAt: { not: null } },
        data: { deletedAt: null },
      })
      if (res.count === 0) return { error: 'Not found in trash', status: 404 } as const
      const restored = await tx.article.findUnique({ where: { id } })
      return { restored } as const
    })

    if ('scopeError' in result) return result.scopeError
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.restored)
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
    const result = await prisma.$transaction(async (tx) => {
      // Re-read + re-authorize against the current row inside the transaction, and
      // make the hard delete state-aware (only a row still in trash is removed) so
      // it cannot race a concurrent restore. Audit + delete commit atomically.
      const article = await tx.article.findUnique({ where: { id } })
      if (!article || !article.deletedAt) {
        return { error: 'Not found in trash', status: 404 } as const
      }
      if (user.role === 'WRITER' && article.authorId !== user.id) {
        return { error: 'Forbidden', status: 403 } as const
      }
      const scopeError = await editorCategoryScope(user, article)
      if (scopeError) return { scopeError } as const

      const res = await tx.article.deleteMany({ where: { id, deletedAt: { not: null } } })
      if (res.count === 0) return { error: 'Not found in trash', status: 404 } as const

      await tx.auditLog.create({
        data: {
          action: 'ARTICLE_HARD_DELETED',
          targetId: id,
          targetType: 'article',
          performedBy: user.id,
          metadata: { title: article.title, authorId: article.authorId },
        },
      })
      return { success: true } as const
    })

    if ('scopeError' in result) return result.scopeError
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to permanently delete article' }, { status: 500 })
  }
}
