import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES, ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

const COMMENT_MODERATION_ROLES = [...EDITORIAL_MANAGEMENT_ROLES, ...ANALYTICS_ACCESS_ROLES] as const

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await getVerifiedSessionUser(COMMENT_MODERATION_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const tab = searchParams.get('tab') ?? 'reported' // 'reported' | 'recent' | 'hidden'
  const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
  const PER_PAGE = 30

  const where =
    tab === 'reported' ? { isReported: true, isHidden: false }
    : tab === 'hidden' ? { isHidden: true }
    : {} // 'recent' = all comments

  // Guard the DB work so a pooler hiccup degrades to a structured payload the
  // moderation UI can render as an error banner — not an unhandled 503 that
  // leaves the page stuck on its loading skeleton. Four queries (down from six:
  // the old handler fired an unused aggregate and a redundant per-tab count that
  // is now derived from the stat counts below), cutting connection pressure.
  try {
    const [comments, reported, hidden, total] = await Promise.all([
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
      prisma.comment.count({ where: { isReported: true, isHidden: false } }),
      prisma.comment.count({ where: { isHidden: true } }),
      prisma.comment.count(),
    ])

    const tabTotal = tab === 'reported' ? reported : tab === 'hidden' ? hidden : total

    return NextResponse.json({
      comments,
      total: tabTotal,
      page,
      perPage: PER_PAGE,
      stats: { total, reported, hidden },
    })
  } catch (err) {
    console.error('GET /api/editorial/comments failed:', err)
    return NextResponse.json(
      {
        error: 'Failed to load comments',
        comments: [],
        total: 0,
        page,
        perPage: PER_PAGE,
        stats: { total: 0, reported: 0, hidden: 0 },
      },
      { status: 503 },
    )
  }
}
