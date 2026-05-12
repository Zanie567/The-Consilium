import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ALL_ROLES, EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

interface Props {
  params: Promise<{ commentId: string }>
}

export async function DELETE(_req: Request, { params }: Props) {
  const { commentId } = await params
  const user = await getVerifiedSessionUser(ALL_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { userId: true },
  })
  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const isOwner = comment.userId === user.id
  const isAdminOrEditor = (EDITORIAL_MANAGEMENT_ROLES as readonly string[]).includes(user.role)

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
