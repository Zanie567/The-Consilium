import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkArticleCommentAccess } from '@/lib/articleCommentAccess'
import type { CommentAccessGrant } from '@/lib/articleCommentAccess'
import type { ArticleComment } from '@prisma/client'

interface Props {
  params: Promise<{ id: string }>
}

const MAX_COMMENT_LENGTH = 5000
const MAX_QUOTE_LENGTH = 5000

function serialize(comment: ArticleComment & { author?: { name: string | null; email: string | null } }, fallbackName?: string | null) {
  return {
    id: comment.id,
    articleId: comment.articleId,
    authorId: comment.authorId,
    commentText: comment.commentText,
    resolved: comment.resolved,
    createdAt: comment.createdAt,
    parentId: comment.parentId,
    tiptapFrom: comment.tiptapFrom,
    tiptapTo: comment.tiptapTo,
    quotedText: comment.quotedText,
    authorName: comment.author?.name ?? comment.author?.email ?? fallbackName ?? 'Unknown',
  }
}

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params
  try {
    const access = await checkArticleCommentAccess(id)
    if (!access.ok) return access.response

    const comments = await prisma.articleComment.findMany({
      where: { articleId: id },
      include: { author: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(comments.map((c) => serialize(c)))
  } catch (error) {
    console.error('List article comments error:', error)
    return NextResponse.json({ error: 'Failed to load comments.' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: Props) {
  const { id } = await params
  try {
    const access = await checkArticleCommentAccess(id)
    if (!access.ok) return access.response
    const { user, article } = access.grant

    const body = (await req.json().catch(() => ({}))) as {
      commentText?: unknown
      parentId?: unknown
      tiptapFrom?: unknown
      tiptapTo?: unknown
      quotedText?: unknown
    }

    const commentText = typeof body.commentText === 'string' ? body.commentText.trim() : ''
    if (!commentText) {
      return NextResponse.json({ error: 'A comment cannot be empty.' }, { status: 400 })
    }
    if (commentText.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json({ error: 'That comment is too long.' }, { status: 400 })
    }

    const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null

    let parent: ArticleComment | null = null
    if (parentId) {
      parent = await prisma.articleComment.findUnique({ where: { id: parentId } })
      if (!parent || parent.articleId !== id) {
        return NextResponse.json({ error: 'That comment thread no longer exists.' }, { status: 400 })
      }
      if (parent.parentId) {
        return NextResponse.json({ error: 'Replies can only be added to a top-level comment.' }, { status: 400 })
      }
    }

    // Anchors only make sense on top-level comments; replies inherit the
    // thread's anchor.
    let tiptapFrom: number | null = null
    let tiptapTo: number | null = null
    let quotedText: string | null = null
    if (!parentId) {
      const from = body.tiptapFrom
      const to = body.tiptapTo
      if (typeof from === 'number' || typeof to === 'number') {
        if (
          typeof from !== 'number' || typeof to !== 'number' ||
          !Number.isInteger(from) || !Number.isInteger(to) ||
          from < 0 || to <= from
        ) {
          return NextResponse.json({ error: 'That text selection is not valid.' }, { status: 400 })
        }
        tiptapFrom = from
        tiptapTo = to
      }
      if (typeof body.quotedText === 'string' && body.quotedText) {
        quotedText = body.quotedText.slice(0, MAX_QUOTE_LENGTH)
      }
    }

    const created = await prisma.articleComment.create({
      data: {
        articleId: id,
        authorId: user.id,
        commentText,
        parentId,
        tiptapFrom,
        tiptapTo,
        quotedText,
      },
    })

    // Notifications follow the existing in-app Notification patterns. They are
    // best effort: a notification hiccup must not lose the comment itself.
    try {
      await notifyAboutComment({ grant: access.grant, parent, article })
    } catch (error) {
      console.error('Comment notification error:', error)
    }

    return NextResponse.json(serialize(created, user.name ?? user.email), { status: 201 })
  } catch (error) {
    console.error('Create article comment error:', error)
    return NextResponse.json({ error: 'Failed to save the comment.' }, { status: 500 })
  }
}

async function notifyAboutComment({
  grant,
  parent,
  article,
}: {
  grant: CommentAccessGrant
  parent: ArticleComment | null
  article: { id: string; authorId: string; title: string }
}) {
  const { user } = grant
  const commenterName = user.name ?? 'A colleague'

  if (!parent) {
    // New thread: tell the article's author, unless they wrote it themselves.
    if (article.authorId === user.id) return
    await prisma.notification.create({
      data: {
        userId: article.authorId,
        type: 'comment',
        title: 'New comment on your draft',
        message: `${commenterName} left a comment on "${article.title}".`,
        articleId: article.id,
      },
    })
    return
  }

  // Reply: tell everyone in the thread plus the article's author, except the
  // person replying. Resolved threads stop notifying.
  if (parent.resolved) return

  const replies = await prisma.articleComment.findMany({
    where: { parentId: parent.id },
    select: { authorId: true },
  })
  const recipients = new Set<string>([
    parent.authorId,
    article.authorId,
    ...replies.map((r) => r.authorId),
  ])
  recipients.delete(user.id)
  if (recipients.size === 0) return

  await prisma.notification.createMany({
    data: [...recipients].map((userId) => ({
      userId,
      type: 'comment_reply',
      title: 'New reply to a comment',
      message: `${commenterName} replied to a comment thread on "${article.title}".`,
      articleId: article.id,
    })),
  })
}
