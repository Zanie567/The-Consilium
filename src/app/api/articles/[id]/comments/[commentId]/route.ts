import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ id: string; commentId: string }>
}

interface ArticleCommentRow {
  id: string
  articleId: string
  authorId: string
  commentText: string
  resolved: boolean
  createdAt: string
  parentId: string | null
  tiptapFrom: number | null
  tiptapTo: number | null
}

export async function PATCH(req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, commentId } = await params
  const body = await req.json() as { resolved?: boolean; commentText?: string }

  const article = await prisma.article.findUnique({ where: { id }, select: { id: true } })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Update only the fields that were provided, using separate safe queries.
  // Both resolved and commentText can be updated in one combined query
  // using CASE-based assignments to avoid dynamic SQL.

  const newResolved = typeof body.resolved === 'boolean' ? body.resolved : null
  const newText = body.commentText?.trim() ?? null

  if (newResolved === null && newText === null) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  let rows: ArticleCommentRow[]

  if (newResolved !== null && newText !== null) {
    rows = await prisma.$queryRaw<ArticleCommentRow[]>`
      UPDATE article_comments
      SET resolved = ${newResolved}, comment_text = ${newText}
      WHERE id = ${commentId} AND article_id = ${id}
      RETURNING
        id, article_id AS "articleId", author_id AS "authorId",
        comment_text AS "commentText", resolved, created_at AS "createdAt",
        parent_id AS "parentId", tiptap_from AS "tiptapFrom", tiptap_to AS "tiptapTo"
    `
  } else if (newResolved !== null) {
    rows = await prisma.$queryRaw<ArticleCommentRow[]>`
      UPDATE article_comments
      SET resolved = ${newResolved}
      WHERE id = ${commentId} AND article_id = ${id}
      RETURNING
        id, article_id AS "articleId", author_id AS "authorId",
        comment_text AS "commentText", resolved, created_at AS "createdAt",
        parent_id AS "parentId", tiptap_from AS "tiptapFrom", tiptap_to AS "tiptapTo"
    `
  } else {
    rows = await prisma.$queryRaw<ArticleCommentRow[]>`
      UPDATE article_comments
      SET comment_text = ${newText}
      WHERE id = ${commentId} AND article_id = ${id}
      RETURNING
        id, article_id AS "articleId", author_id AS "authorId",
        comment_text AS "commentText", resolved, created_at AS "createdAt",
        parent_id AS "parentId", tiptap_from AS "tiptapFrom", tiptap_to AS "tiptapTo"
    `
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  return NextResponse.json(rows[0])
}
