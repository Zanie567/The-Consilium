import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { editorCanAccessCategory } from '@/lib/articleCategoryScope'
import { apiError } from '@/lib/apiResponse'

interface Props {
  params: Promise<{ id: string }>
}

// PATCH /api/editorial/trash/[id] - restore a soft-deleted article
export async function PATCH(_req: NextRequest, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

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
      if (user.role === 'EDITOR') {
        const scope = await loadEditorCategoryScope(user.id, tx)
        if (!editorCanAccessCategory(scope, article.categoryId)) {
          return { scopeDenied: true } as const
        }
      }

      const res = await tx.article.updateMany({
        where: { id, deletedAt: { not: null } },
        data: { deletedAt: null },
      })
      if (res.count === 0) return { error: 'Not found in trash', status: 404 } as const
      const restored = await tx.article.findUnique({ where: { id } })
      return { restored } as const
    })

    if ('scopeDenied' in result) {
      return apiError(
        'This article is outside your assigned categories.',
        403,
        'CATEGORY_SCOPE_DENIED'
      )
    }
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.restored)
  } catch {
    return NextResponse.json({ error: 'Failed to restore article' }, { status: 500 })
  }
}

// DELETE /api/editorial/trash/[id] - permanently delete a trashed article
export async function DELETE(_req: NextRequest, { params }: Props) {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  const user = auth.user

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
      if (user.role === 'EDITOR') {
        const scope = await loadEditorCategoryScope(user.id, tx)
        if (!editorCanAccessCategory(scope, article.categoryId)) {
          return { scopeDenied: true } as const
        }
      }

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

    if ('scopeDenied' in result) {
      return apiError(
        'This article is outside your assigned categories.',
        403,
        'CATEGORY_SCOPE_DENIED'
      )
    }
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to permanently delete article' }, { status: 500 })
  }
}
