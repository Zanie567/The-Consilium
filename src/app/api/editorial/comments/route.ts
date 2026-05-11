import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES, ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

const COMMENT_MODERATION_ROLES = [...EDITORIAL_MANAGEMENT_ROLES, ...ANALYTICS_ACCESS_ROLES] as const

export async function GET(req: Request) {
  const user = await getVerifiedSessionUser(COMMENT_MODERATION_ROLES)
  if (!user) {
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

  const [comments, total, _stats] = await Promise.all([
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
