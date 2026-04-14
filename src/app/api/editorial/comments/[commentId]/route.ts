import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ commentId: string }>
}

// PATCH: approve (clear isReported) or hide
export async function PATCH(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session?.user || !['ADMIN', 'EDITOR'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { commentId } = await params
  const body = await req.json()
  const { action } = body // 'approve' | 'hide'

  if (action === 'approve') {
    await prisma.comment.update({
      where: { id: commentId },
      data: { isReported: false },
    })
  } else if (action === 'hide') {
    await prisma.comment.update({
      where: { id: commentId },
      data: { isHidden: true, body: '[Comment removed]' },
    })
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
