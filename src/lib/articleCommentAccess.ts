/**
 * Shared authorization for the inline review comment endpoints.
 *
 * The matrix, enforced server-side on every comment route:
 *   ADMIN                       full access to comments on any article
 *   EDITOR (in category scope)  full access, mirroring the review routes
 *   EDITOR (out of scope)       no access, unless they authored the article
 *   WRITER                      read, comment, reply, and resolve on their
 *                               own articles only
 *   GROWTH / READER / no user   no access
 */
import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Role } from '@prisma/client'

export interface CommentAccessGrant {
  user: { id: string; role: Role; name: string | null; email: string | null }
  article: { id: string; authorId: string; title: string }
  /** True for admins and in-scope editors; false for the article's author. */
  isEditorial: boolean
  isArticleAuthor: boolean
}

export type CommentAccessResult =
  | { ok: true; grant: CommentAccessGrant }
  | { ok: false; response: NextResponse }

export async function checkArticleCommentAccess(articleId: string): Promise<CommentAccessResult> {
  const user = await getVerifiedSessionUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'You need to sign in to do that.' }, { status: 401 }),
    }
  }

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, authorId: true, title: true, categoryId: true, deletedAt: true },
  })
  if (!article || article.deletedAt) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  const isArticleAuthor = article.authorId === user.id
  const grant = (isEditorial: boolean): CommentAccessResult => ({
    ok: true,
    grant: {
      user,
      article: { id: article.id, authorId: article.authorId, title: article.title },
      isEditorial,
      isArticleAuthor,
    },
  })
  const forbidden = (message: string): CommentAccessResult => ({
    ok: false,
    response: NextResponse.json({ error: message }, { status: 403 }),
  })

  if (user.role === 'ADMIN') return grant(true)

  if (user.role === 'EDITOR') {
    // Editors are scoped to assigned categories, mirroring the review routes.
    let inScope = true
    if (article.categoryId) {
      const assignment = await prisma.categoryEditor.findFirst({
        where: { userId: user.id, categoryId: article.categoryId },
      })
      inScope = Boolean(assignment)
    } else {
      const anyAssignment = await prisma.categoryEditor.findFirst({
        where: { userId: user.id },
      })
      inScope = !anyAssignment
    }
    if (inScope) return grant(true)
    if (isArticleAuthor) return grant(false)
    return forbidden('This article is outside your assigned categories.')
  }

  if (user.role === 'WRITER') {
    if (isArticleAuthor) return grant(false)
    return forbidden('You can only view feedback on your own articles.')
  }

  return forbidden('You do not have access to editorial comments.')
}
