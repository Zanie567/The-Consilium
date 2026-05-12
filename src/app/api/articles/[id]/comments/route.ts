import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const article = await prisma.article.findUnique({ where: { id }, select: { id: true } })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Raw query because article_comments is not in the Prisma schema yet.
  // ACTION REQUIRED: run the SQL in supabase/migrations/add_article_comments.sql
  // before deploying this route.
  const comments = await prisma.$queryRaw<ArticleCommentRow[]>`
    SELECT
      c.id,
      c.article_id  AS "articleId",
      c.author_id   AS "authorId",
      c.comment_text AS "commentText",
      c.resolved,
      c.created_at  AS "createdAt",
      c.parent_id   AS "parentId",
      c.tiptap_from AS "tiptapFrom",
      c.tiptap_to   AS "tiptapTo",
      u.name        AS "authorName"
    FROM article_comments c
    JOIN "User" u ON u.id = c.author_id
    WHERE c.article_id = ${id}
    ORDER BY c.created_at ASC
  `

  return NextResponse.json(comments)
}

export async function POST(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    commentText?: string
    parentId?: string | null
    tiptapFrom?: number
    tiptapTo?: number
  }

  if (!body.commentText?.trim()) {
    return NextResponse.json({ error: 'commentText required' }, { status: 400 })
  }

  const article = await prisma.article.findUnique({ where: { id }, select: { id: true } })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await prisma.$queryRaw<ArticleCommentRow[]>`
    INSERT INTO article_comments
      (article_id, author_id, comment_text, parent_id, tiptap_from, tiptap_to)
    VALUES (
      ${id},
      ${session.user.id},
      ${body.commentText.trim()},
      ${body.parentId ?? null},
      ${body.tiptapFrom ?? null},
      ${body.tiptapTo ?? null}
    )
    RETURNING
      id,
      article_id   AS "articleId",
      author_id    AS "authorId",
      comment_text AS "commentText",
      resolved,
      created_at   AS "createdAt",
      parent_id    AS "parentId",
      tiptap_from  AS "tiptapFrom",
      tiptap_to    AS "tiptapTo"
  `

  const row = rows[0]
  return NextResponse.json({ ...row, authorName: session.user.name ?? session.user.email }, { status: 201 })
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
  authorName?: string
}
