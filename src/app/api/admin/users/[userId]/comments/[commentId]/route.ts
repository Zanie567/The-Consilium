import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY } from '@/lib/rbac'

interface Ctx { params: Promise<{ userId: string; commentId: string }> }

// DELETE - soft-hide a comment (admin moderation)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, commentId } = await params
  const adminId = admin.id
  const adminName = adminId

  const comment = await prisma.comment.findUnique({
    where: { id: commentId, userId },
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
