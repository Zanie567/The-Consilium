import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES } from '@/lib/rbac'

interface Props {
  params: Promise<{ commentId: string }>
}

export async function POST(_req: Request, { params }: Props) {
  const { commentId } = await params
  const user = await getVerifiedSessionUser(ALL_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, isHidden: true },
  })
  if (!comment || comment.isHidden) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const existing = await prisma.commentUpvote.findUnique({
    where: { commentId_userId: { commentId, userId: user.id } },
  })

  if (existing) {
    // Toggle off
    await prisma.$transaction([
      prisma.commentUpvote.delete({ where: { commentId_userId: { commentId, userId: user.id } } }),
      prisma.comment.update({ where: { id: commentId }, data: { upvotes: { decrement: 1 } } }),
    ])
    const updated = await prisma.comment.findUnique({ where: { id: commentId }, select: { upvotes: true } })
    return NextResponse.json({ upvotes: updated?.upvotes ?? 0, upvoted: false })
  } else {
    // Toggle on
    await prisma.$transaction([
      prisma.commentUpvote.create({ data: { commentId, userId: user.id } }),
      prisma.comment.update({ where: { id: commentId }, data: { upvotes: { increment: 1 } } }),
    ])
    const updated = await prisma.comment.findUnique({ where: { id: commentId }, select: { upvotes: true } })
    return NextResponse.json({ upvotes: updated?.upvotes ?? 0, upvoted: true })
  }
}
