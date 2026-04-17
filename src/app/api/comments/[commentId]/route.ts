import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ commentId: string }>
}

export async function DELETE(_req: Request, { params }: Props) {
  const { commentId } = await params
  const session = await getServerSession(authOptions)
  // BUG-20: reject missing sessions and banned users
  const authError = requireActiveSession(session)
  if (authError) return authError

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { userId: true },
  })
  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const isOwner = comment.userId === session!.user.id
  // BUG-24: editors should be able to moderate comments, not just admins
  const isAdminOrEditor = session!.user.role === 'ADMIN' || session!.user.role === 'EDITOR'

  if (!isOwner && !isAdminOrEditor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Soft delete
  await prisma.comment.update({
    where: { id: commentId },
    data: { isHidden: true, body: '[Comment removed]' },
  })

  return NextResponse.json({ ok: true })
}
