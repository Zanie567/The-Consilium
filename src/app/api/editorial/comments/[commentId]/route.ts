import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ commentId: string }>
}

// PATCH: approve (clear isReported), hide, or unhide
// GROWTH users can hide/unhide but cannot approve (clear reports)
export async function PATCH(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  const role = session?.user?.role ?? ''
  if (!session?.user || !['ADMIN', 'EDITOR', 'GROWTH'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { commentId } = await params
  const body = await req.json()
  const { action } = body // 'approve' | 'hide' | 'unhide'

  if (action === 'approve') {
    if (role === 'GROWTH') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await prisma.comment.update({
      where: { id: commentId },
      data: { isReported: false },
    })
  } else if (action === 'hide') {
    await prisma.comment.update({
      where: { id: commentId },
      data: { isHidden: true, body: '[Comment removed]' },
    })
  } else if (action === 'unhide') {
    await prisma.comment.update({
      where: { id: commentId },
      data: { isHidden: false },
    })
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
