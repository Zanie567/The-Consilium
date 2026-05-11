import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

type ReviewCommentRow = {
  thread_id: string
  article_id: string
  anchor_text: string
  selected_text: string
  resolved: boolean
  thread_created_at: Date
  reply_id: string | null
  reply_body: string | null
  reply_created_at: Date | null
  author_id: string | null
  author_name: string | null
}

type ReviewCommentThread = {
  id: string
  articleId: string
  anchorText: string
  selectedText: string
  resolved: boolean
  createdAt: string
  replies: {
    id: string
    body: string
    createdAt: string
    author: { id: string; name: string | null }
  }[]
}

async function requireReviewer() {
  return getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
}

function isMissingReviewCommentTable(error: unknown) {
  return error instanceof Error && error.message.includes('review_comment')
}

export async function GET(req: NextRequest) {
  const session = await requireReviewer()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const articleId = req.nextUrl.searchParams.get('articleId')
  if (!articleId) return NextResponse.json({ error: 'articleId is required' }, { status: 400 })

  try {
    const rows = await prisma.$queryRaw<ReviewCommentRow[]>`
      SELECT
        t.id::text AS thread_id,
        t.article_id,
        t.anchor_text,
        t.selected_text,
        t.resolved,
        t.created_at AS thread_created_at,
        r.id::text AS reply_id,
        r.body AS reply_body,
        r.created_at AS reply_created_at,
        u.id AS author_id,
        u.name AS author_name
      FROM review_comment_threads t
      LEFT JOIN review_comment_replies r ON r.thread_id = t.id
      LEFT JOIN users u ON u.id = r.author_id
      WHERE t.article_id = ${articleId}
      ORDER BY t.created_at ASC, r.created_at ASC
    `

    const threads = new Map<string, ReviewCommentThread>()
    for (const row of rows) {
      if (!threads.has(row.thread_id)) {
        threads.set(row.thread_id, {
          id: row.thread_id,
          articleId: row.article_id,
          anchorText: row.anchor_text,
          selectedText: row.selected_text,
          resolved: row.resolved,
          createdAt: row.thread_created_at.toISOString(),
          replies: [],
        })
      }
      if (row.reply_id && row.reply_body && row.reply_created_at && row.author_id) {
        threads.get(row.thread_id)?.replies.push({
          id: row.reply_id,
          body: row.reply_body,
          createdAt: row.reply_created_at.toISOString(),
          author: { id: row.author_id, name: row.author_name },
        })
      }
    }

    return NextResponse.json(Array.from(threads.values()))
  } catch (error) {
    if (isMissingReviewCommentTable(error)) return NextResponse.json([])
    return NextResponse.json({ error: 'Failed to load review comments' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireReviewer()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json()) as {
    articleId?: unknown
    threadId?: unknown
    selectedText?: unknown
    anchorText?: unknown
    body?: unknown
  }

  const commentBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!commentBody) return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })

  try {
    if (typeof body.threadId === 'string') {
      const [reply] = await prisma.$queryRaw<
        { id: string; body: string; created_at: Date; author_id: string; author_name: string | null }[]
      >`
        INSERT INTO review_comment_replies (thread_id, author_id, body)
        VALUES (${body.threadId}::uuid, ${session.id}, ${commentBody})
        RETURNING id::text, body, created_at, author_id, (
          SELECT name FROM users WHERE id = ${session.id}
        ) AS author_name
      `
      return NextResponse.json({
        id: reply.id,
        body: reply.body,
        createdAt: reply.created_at.toISOString(),
        author: { id: reply.author_id, name: reply.author_name },
      })
    }

    if (
      typeof body.articleId !== 'string' ||
      typeof body.selectedText !== 'string' ||
      typeof body.anchorText !== 'string'
    ) {
      return NextResponse.json({ error: 'articleId, selectedText, and anchorText are required' }, { status: 400 })
    }

    const [thread] = await prisma.$queryRaw<
      {
        id: string
        created_at: Date
        selected_text: string
        anchor_text: string
        article_id: string
        reply_id: string
        reply_created_at: Date
      }[]
    >`
      WITH new_thread AS (
        INSERT INTO review_comment_threads (article_id, anchor_text, selected_text, created_by)
        VALUES (${body.articleId}, ${body.anchorText}, ${body.selectedText}, ${session.id})
        RETURNING id, article_id, anchor_text, selected_text, created_at
      ),
      new_reply AS (
        INSERT INTO review_comment_replies (thread_id, author_id, body)
        SELECT id, ${session.id}, ${commentBody} FROM new_thread
        RETURNING id, created_at
      )
      SELECT
        new_thread.id::text,
        new_thread.article_id,
        new_thread.anchor_text,
        new_thread.selected_text,
        new_thread.created_at,
        new_reply.id::text AS reply_id,
        new_reply.created_at AS reply_created_at
      FROM new_thread, new_reply
    `

    return NextResponse.json({
      id: thread.id,
      articleId: thread.article_id,
      anchorText: thread.anchor_text,
      selectedText: thread.selected_text,
      resolved: false,
      createdAt: thread.created_at.toISOString(),
      replies: [{
        id: thread.reply_id,
        body: commentBody,
        createdAt: thread.reply_created_at.toISOString(),
        author: { id: session.id, name: null },
      }],
    })
  } catch (error) {
    if (isMissingReviewCommentTable(error)) {
      return NextResponse.json({ error: 'Review comment tables are not installed.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to save review comment' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireReviewer()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json()) as { threadId?: unknown; resolved?: unknown }
  if (typeof body.threadId !== 'string' || typeof body.resolved !== 'boolean') {
    return NextResponse.json({ error: 'threadId and resolved are required' }, { status: 400 })
  }

  try {
    await prisma.$executeRaw`
      UPDATE review_comment_threads
      SET resolved = ${body.resolved}, updated_at = now()
      WHERE id = ${body.threadId}::uuid
    `
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isMissingReviewCommentTable(error)) {
      return NextResponse.json({ error: 'Review comment tables are not installed.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to update review comment' }, { status: 500 })
  }
}
