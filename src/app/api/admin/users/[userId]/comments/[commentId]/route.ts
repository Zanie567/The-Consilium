import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Ctx { params: Promise<{ userId: string; commentId: string }> }

// DELETE — soft-hide a comment (admin moderation)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { commentId } = await params
  const adminId = session.user.id
  const adminName = session.user.name ?? session.user.email ?? adminId

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true, body: true, article: { select: { title: true } } },
  })
  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  await prisma.comment.update({
    where: { id: commentId },
    data: { isHidden: true },
  })

  await prisma.auditLog.create({
    data: {
      action: 'COMMENT_REMOVED_BY_ADMIN',
      targetId: commentId,
      targetType: 'comment',
      performedBy: adminId,
      metadata: {
        commentUserId: comment.userId,
        articleTitle: comment.article.title,
        excerpt: comment.body.slice(0, 100),
        adminName,
      },
    },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
