import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { subDays } from 'date-fns'
import { estimateReadingMinutes } from '@/lib/reading-minutes'

// Accessible to writers and above - NOT readers
const LEADERBOARD_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH']

type LeaderboardPeriod = 'week' | 'month' | 'alltime'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string })?.role ?? ''
  if (!session || !LEADERBOARD_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('period') ?? 'month'
  const period: LeaderboardPeriod =
    raw === 'week' ? 'week' : raw === 'alltime' ? 'alltime' : 'month'

  const now = new Date()
  const since: Date | null =
    period === 'week' ? subDays(now, 7)
    : period === 'month' ? subDays(now, 30)
    : null  // alltime = no filter

  // Previous period for rank comparison
  const prevSince: Date | null =
    period === 'week' ? subDays(now, 14)
    : period === 'month' ? subDays(now, 60)
    : null

  async function buildLeaderboard(periodSince: Date | null) {
    const publishFilter = periodSince
      ? { status: 'PUBLISHED' as const, deletedAt: null, publishedAt: { gte: periodSince } }
      : { status: 'PUBLISHED' as const, deletedAt: null }

    const writers = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
      select: {
        id: true, name: true, email: true, slug: true,
        articles: {
          where: publishFilter,
          select: {
            id: true, viewCount: true, content: true,
            _count: { select: { comments: { where: { isHidden: false } } } },
          },
        },
      },
    }).catch(() => [])

    const allIds = writers.flatMap(w => w.articles.map(a => a.id))
    const progressGroups = allIds.length > 0
      ? await prisma.readingProgress.groupBy({
          by: ['articleId'],
          where: { articleId: { in: allIds } },
          _avg: { progress: true },
        }).catch(() => [] as { articleId: string; _avg: { progress: number | null } }[])
      : []
    const progressMap = new Map(progressGroups.map(p => [p.articleId, p._avg.progress ?? 0]))

    return writers
      .filter(w => w.articles.length > 0)
      .map(writer => {
        const totalReadingMinutes = writer.articles.reduce((sum, a) => {
          return sum + estimateReadingMinutes(a.content, progressMap.get(a.id) ?? 0)
        }, 0)
        const avgCompletionRate =
          Math.round(writer.articles.reduce((s, a) => s + (progressMap.get(a.id) ?? 0), 0) / writer.articles.length)
        const totalViews = writer.articles.reduce((s, a) => s + a.viewCount, 0)
        const commentsGenerated = writer.articles.reduce((s, a) => s + a._count.comments, 0)
        return {
          id: writer.id,
          name: writer.name ?? writer.email ?? 'Unknown',
          slug: writer.slug ?? null,
          articlesCount: writer.articles.length,
          totalReadingMinutes: Math.round(totalReadingMinutes * 10) / 10,
          avgCompletionRate,
          avgViewsPerArticle: writer.articles.length > 0 ? Math.round(totalViews / writer.articles.length) : 0,
          commentsGenerated,
        }
      })
      .sort((a, b) => b.totalReadingMinutes - a.totalReadingMinutes)
      .map((w, i) => ({ ...w, rank: i + 1 }))
  }

  const [currentBoard, prevBoard] = await Promise.all([
    buildLeaderboard(since),
    prevSince ? buildLeaderboard(prevSince) : Promise.resolve([]),
  ])

  const currentUserId = (session.user as { id?: string })?.id ?? ''

  // Attach rank change
  const boardWithChange = currentBoard.map(w => {
    const prev = prevBoard.find(p => p.id === w.id)
    const rankChange = prev ? prev.rank - w.rank : null // positive = moved up
    return { ...w, rankChange }
  })

  return NextResponse.json({ writers: boardWithChange, currentUserId })
}
