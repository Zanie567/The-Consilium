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
    rawViews,
    publishedInPeriod,
    allViewSources,
  ] = await Promise.all([
    prisma.article
      .aggregate({ where: { deletedAt: null }, _sum: { viewCount: true } })
      .then((r) => r._sum.viewCount ?? 0)
      .catch(() => 0),

    prisma.article.count({ where: { status: 'PUBLISHED', deletedAt: null } }).catch(() => 0),

    prisma.user.count().catch(() => 0),

    prisma.articleView.count({ where: { viewedAt: { gte: since } } }).catch(() => 0),

    prisma.articleView
      .count({ where: { viewedAt: { gte: prevSince, lt: since } } })
      .catch(() => 0),

    prisma.article
      .count({ where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { gte: since } } })
      .catch(() => 0),

    prisma.article
      .findMany({
        where: { status: 'PUBLISHED', deletedAt: null },
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
          articles: { where: { status: 'PUBLISHED', deletedAt: null }, select: { viewCount: true } },
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
            where: { status: 'PUBLISHED', deletedAt: null },
            select: { viewCount: true },
          },
        },
      })
      .catch(() => []),

    prisma.article
      .findMany({
        where: { status: 'PUBLISHED', deletedAt: null },
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

    // Fetch raw view timestamps in period and group in JS (avoids DATE_TRUNC raw SQL)
    prisma.articleView
      .findMany({ where: { viewedAt: { gte: since } }, select: { viewedAt: true } })
      .catch(() => [] as { viewedAt: Date }[]),

    // Published articles in period with their publishedAt timestamps
    prisma.article
      .findMany({
        where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { gte: since } },
        select: { publishedAt: true },
      })
      .catch(() => [] as { publishedAt: Date | null }[]),

    // Traffic sources: all views ever (source column may be null for pre-migration rows)
    prisma.articleView
      .findMany({ select: { source: true } })
      .catch(() => [] as { source: string | null }[]),
  ])

  // Group views and publishes into buckets entirely in JS
  const bucketKey = (d: Date) =>
    period === '24h' ? format(d, 'yyyy-MM-dd HH:00') : format(d, 'yyyy-MM-dd')

  const trafficMap = new Map<string, number>()
  for (const v of rawViews) {
    const k = bucketKey(v.viewedAt)
    trafficMap.set(k, (trafficMap.get(k) ?? 0) + 1)
  }

  const publishMap = new Map<string, number>()
  for (const a of publishedInPeriod) {
    if (a.publishedAt) {
      const k = bucketKey(a.publishedAt)
      publishMap.set(k, (publishMap.get(k) ?? 0) + 1)
    }
  }

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
      label = format(d, 'd MMM')
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

  // Aggregate traffic sources; rows without a source count as Direct
  const SOURCE_ORDER = ['Direct', 'Search', 'Social', 'Email', 'Other'] as const
  const sourceMap = new Map<string, number>()
  for (const v of allViewSources) {
    const s = v.source ?? 'Direct'
    sourceMap.set(s, (sourceMap.get(s) ?? 0) + 1)
  }
  const totalSourceViews = allViewSources.length || 1
  const trafficSources = SOURCE_ORDER.filter((s) => sourceMap.has(s) || s === 'Direct').map((s) => ({
    source: s,
    views: sourceMap.get(s) ?? 0,
    pct: Math.round(((sourceMap.get(s) ?? 0) / totalSourceViews) * 100),
  }))

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
    trafficSources,
    topArticles,
    categoryData,
    authorData,
    recentActivity,
  })
}
