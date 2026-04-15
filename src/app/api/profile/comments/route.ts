import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/profile/comments — user's comments with article context
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const comments = await prisma.comment.findMany({
      where: { userId: session.user.id, isHidden: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        article: {
          select: { id: true, title: true, slug: true, category: { select: { name: true } } },
        },
        _count: { select: { upvotedBy: true } },
      },
    })

    return NextResponse.json(comments)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }
}
