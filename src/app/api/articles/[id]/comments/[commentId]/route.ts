import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkArticleCommentAccess } from '@/lib/articleCommentAccess'

interface Props {
  params: Promise<{ id: string; commentId: string }>
}

const MAX_COMMENT_LENGTH = 5000

export async function PATCH(req: Request, { params }: Props) {
  const { id, commentId } = await params
  try {
    const access = await checkArticleCommentAccess(id)
    if (!access.ok) return access.response
    const { user, isEditorial, isArticleAuthor } = access.grant

    const body = (await req.json().catch(() => ({}))) as {
      resolved?: unknown
      commentText?: unknown
    }

    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      include: { author: { select: { name: true } } },
    })
    if (!comment || comment.articleId !== id) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const newResolved = typeof body.resolved === 'boolean' ? body.resolved : null
    const newText = typeof body.commentText === 'string' ? body.commentText.trim() : null

    if (newResolved === null && newText === null) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // Resolving and reopening is for editors and the article's author.
    if (newResolved !== null && !isEditorial && !isArticleAuthor) {
      return NextResponse.json(
        { error: 'Only editors and the article author can resolve comments.' },
        { status: 403 }
      )
    }

    // Editing the text of a comment is for the person who wrote it.
    if (newText !== null) {
      if (comment.authorId !== user.id) {
        return NextResponse.json(
          { error: 'You can only edit your own comments.' },
          { status: 403 }
        )
      }
      if (!newText) {
        return NextResponse.json({ error: 'A comment cannot be empty.' }, { status: 400 })
      }
      if (newText.length > MAX_COMMENT_LENGTH) {
        return NextResponse.json({ error: 'That comment is too long.' }, { status: 400 })
      }
    }

    const updated = await prisma.articleComment.update({
      where: { id: commentId },
      data: {
        ...(newResolved !== null && { resolved: newResolved }),
        ...(newText !== null && { commentText: newText }),
      },
    })

    return NextResponse.json({
      id: updated.id,
      articleId: updated.articleId,
      authorId: updated.authorId,
      commentText: updated.commentText,
      resolved: updated.resolved,
      createdAt: updated.createdAt,
      parentId: updated.parentId,
      tiptapFrom: updated.tiptapFrom,
      tiptapTo: updated.tiptapTo,
      quotedText: updated.quotedText,
      // Never return the author's email: the panel only needs a display name.
      authorName: comment.author?.name ?? 'Unknown',
    })
  } catch (error) {
    console.error('Update article comment error:', error)
    return NextResponse.json({ error: 'Failed to update the comment.' }, { status: 500 })
  }
}
