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

  await prisma.comment.update({
    where: { id: commentId },
    data: { isReported: true },
  })

  return NextResponse.json({ ok: true })
}
