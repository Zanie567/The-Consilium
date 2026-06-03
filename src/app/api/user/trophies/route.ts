import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const trophies = await prisma.articleTrophy.findMany({
      where: {
        article: { authorId: session.user.id, deletedAt: null },
      },
      include: {
        article: { select: { title: true, slug: true } },
      },
      orderBy: { awardedAt: 'desc' },
    })

    return NextResponse.json({ trophies })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
