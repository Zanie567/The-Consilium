import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ commentId: string }>
}

export async function DELETE(_req: Request, { params }: Props) {
  const { commentId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { userId: true },
  })
  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const isOwner = comment.userId === session.user.id
  const isAdmin = session.user.role === 'ADMIN'

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Soft delete
  await prisma.comment.update({
    where: { id: commentId },
    data: { isHidden: true, body: '[Comment removed]' },
  })

  return NextResponse.json({ ok: true })
}
