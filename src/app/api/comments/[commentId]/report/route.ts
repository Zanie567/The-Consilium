import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ commentId: string }>
}

export async function POST(_req: Request, { params }: Props) {
  const { commentId } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

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
