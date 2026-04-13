import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { subHours, subDays, format } from 'date-fns'

type Period = '24h' | '7d' | '30d' | '90d'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('period') ?? '30d'
  const period: Period = ['24h', '7d', '30d', '90d'].includes(raw) ? (raw as Period) : '30d'

  const now = new Date()
  const since =
    period === '24h' ? subHours(now, 24)
    : period === '7d' ? subDays(now, 7)
    : period === '90d' ? subDays(now, 90)
    : subDays(now, 30)

  const prevSince =
    period === '24h' ? subHours(now, 48)
    : period === '7d' ? subDays(now, 14)
    : period === '90d' ? subDays(now, 180)
    : subDays(now, 60)

  const truncUnit = period === '24h' ? 'hour' : 'day'
  const bucketCount = period === '24h' ? 24 : period === '7d' ? 7 : period === '90d' ? 90 : 30

  const [
    totalViewsResult,
    totalPublished,
    totalUsers,
    viewsInPeriod,
    viewsInPrevPeriod,
    newInPeriod,
    topArticles,
    categories,
    authors,
    recentActivity,
    trafficByBucket,
    publishingByBucket,
  ] = await Promise.all([
    prisma.article
      .aggregate({ _sum: { viewCount: true } })
      .then((r) => r._sum.viewCount ?? 0)
      .catch(() => 0),

    prisma.article.count({ where: { status: 'PUBLISHED' } }).catch(() => 0),

    prisma.user.count().catch(() => 0),

    prisma.articleView.count({ where: { viewedAt: { gte: since } } }).catch(() => 0),

    prisma.articleView
      .count({ where: { viewedAt: { gte: prevSince, lt: since } } })
      .catch(() => 0),

    prisma.article
      .count({ where: { status: 'PUBLISHED', publishedAt: { gte: since } } })
      .catch(() => 0),

    prisma.article
      .findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { viewCount: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          viewCount: true,
          publishedAt: true,
          author: { select: { name: true } },
          category: { select: { name: true } },
        },
      })
      .catch(() => []),

    prisma.category
      .findMany({
        include: {
          articles: { where: { status: 'PUBLISHED' }, select: { viewCount: true } },
        },
      })
      .catch(() => []),

    prisma.user
      .findMany({
        where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
        select: {
          id: true,
          name: true,
          email: true,
          articles: {
            where: { status: 'PUBLISHED' },
            select: { viewCount: true },
          },
        },
      })
      .catch(() => []),

    prisma.article
      .findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          publishedAt: true,
          viewCount: true,
          author: { select: { name: true } },
          category: { select: { name: true } },
        },
      })
      .catch(() => []),

    prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT DATE_TRUNC(${truncUnit}, "viewedAt") as bucket, COUNT(*) as count
      FROM article_views
      WHERE "viewedAt" >= ${since}
      GROUP BY DATE_TRUNC(${truncUnit}, "viewedAt")
      ORDER BY bucket ASC
    `.catch(() => [] as { bucket: Date; count: bigint }[]),

    prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT DATE_TRUNC(${truncUnit}, "publishedAt") as bucket, COUNT(*) as count
      FROM articles
      WHERE status = 'PUBLISHED' AND "publishedAt" >= ${since}
      GROUP BY DATE_TRUNC(${truncUnit}, "publishedAt")
      ORDER BY bucket ASC
    `.catch(() => [] as { bucket: Date; count: bigint }[]),
  ])

  // Map bucket results
  const trafficMap = new Map(
    trafficByBucket.map((r) => [
      period === '24h'
        ? format(new Date(r.bucket), 'yyyy-MM-dd HH:00')
        : format(new Date(r.bucket), 'yyyy-MM-dd'),
      Number(r.count),
    ])
  )
  const publishMap = new Map(
    publishingByBucket.map((r) => [
      period === '24h'
        ? format(new Date(r.bucket), 'yyyy-MM-dd HH:00')
        : format(new Date(r.bucket), 'yyyy-MM-dd'),
      Number(r.count),
    ])
  )

  const trafficData = Array.from({ length: bucketCount }, (_, i) => {
    let key: string
    let label: string
    if (period === '24h') {
      const d = subHours(now, bucketCount - 1 - i)
      key = format(d, 'yyyy-MM-dd HH:00')
      label = format(d, 'HH:mm')
    } else {
      const d = subDays(now, bucketCount - 1 - i)
      key = format(d, 'yyyy-MM-dd')
      label = period === '90d' ? format(d, 'd MMM') : format(d, 'd MMM')
    }
    return { label, views: trafficMap.get(key) ?? 0, published: publishMap.get(key) ?? 0 }
  })

  const categoryData = categories
    .map((cat) => ({
      name: cat.name,
      views: cat.articles.reduce((sum, a) => sum + a.viewCount, 0),
      articles: cat.articles.length,
    }))
    .filter((c) => c.views > 0)
    .sort((a, b) => b.views - a.views)

  const authorData = authors
    .map((u) => ({
      name: u.name ?? u.email ?? 'Unknown',
      articles: u.articles.length,
      views: u.articles.reduce((sum, a) => sum + a.viewCount, 0),
    }))
    .filter((a) => a.articles > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10)

  const viewsChange =
    viewsInPrevPeriod > 0
      ? Math.round(((viewsInPeriod - viewsInPrevPeriod) / viewsInPrevPeriod) * 100)
      : null

  return NextResponse.json({
    summary: {
      totalViews: totalViewsResult,
      totalPublished,
      totalUsers,
      newInPeriod,
      viewsInPeriod,
      viewsChange,
    },
    trafficData,
    topArticles,
    categoryData,
    authorData,
    recentActivity,
  })
}
