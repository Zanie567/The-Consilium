import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user || !['ADMIN', 'EDITOR', 'GROWTH'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const tab = searchParams.get('tab') ?? 'reported' // 'reported' | 'recent' | 'hidden'
  const page = parseInt(searchParams.get('page') ?? '0', 10)
  const PER_PAGE = 30

  let where = {}
  if (tab === 'reported') where = { isReported: true, isHidden: false }
  else if (tab === 'hidden') where = { isHidden: true }
  else where = {} // 'recent' = all visible

  const [comments, total, stats] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: page * PER_PAGE,
      take: PER_PAGE,
      include: {
        user: { select: { id: true, name: true } },
        article: { select: { id: true, title: true, slug: true } },
      },
    }),
    prisma.comment.count({ where }),
    prisma.comment.aggregate({
      _count: { id: true },
      where: {},
    }),
  ])

  const [reportedCount, hiddenCount, totalCount] = await Promise.all([
    prisma.comment.count({ where: { isReported: true, isHidden: false } }),
    prisma.comment.count({ where: { isHidden: true } }),
    prisma.comment.count(),
  ])

  return NextResponse.json({
    comments,
    total,
    page,
    perPage: PER_PAGE,
    stats: { total: totalCount, reported: reportedCount, hidden: hiddenCount },
  })
}
