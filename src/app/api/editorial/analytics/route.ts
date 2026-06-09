import { getVerifiedSessionUser } from '@/lib/auth'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { subHours, subDays, subWeeks, format, startOfWeek } from 'date-fns'
import { estimateReadingMinutes } from '@/lib/reading-minutes'

type Period = '24h' | '7d' | '30d' | '90d'
type Tab = 'overview' | 'content' | 'audience' | 'engagement' | 'leaderboard' | 'distribution'

function getPeriodDates(period: Period) {
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
  const bucketCount =
    period === '24h' ? 24 : period === '7d' ? 7 : period === '90d' ? 90 : 30
  return { now, since, prevSince, bucketCount }
}

export async function GET(req: NextRequest) {
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('period') ?? '30d'
  const period: Period = (['24h', '7d', '30d', '90d'] as const).includes(raw as Period)
    ? (raw as Period)
    : '30d'
  const tab: Tab =
    (req.nextUrl.searchParams.get('tab') as Tab | null) ?? 'overview'

  const { now, since, prevSince, bucketCount } = getPeriodDates(period)

  switch (tab) {
    case 'overview':     return handleOverview(now, since, prevSince, bucketCount, period)
    case 'content':      return handleContent(now, since)
    case 'audience':     return handleAudience(now, since, prevSince)
    case 'engagement':   return handleEngagement(since, prevSince)
    case 'leaderboard':  return handleLeaderboard()
    case 'distribution': return handleDistribution()
    default:             return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  }
}

// ── Tab handlers ────────────────────────────────────────────────────────────

async function handleOverview(
  now: Date, since: Date, prevSince: Date, bucketCount: number, period: Period,
) {
  const [
    totalViewsResult,
    totalPublished,
    subscriberCount,
    subscribersInPeriod,
    subscribersInPrevPeriod,
    viewsInPeriod,
    viewsInPrevPeriod,
    rawViews,
    publishedInPeriod,
  ] = await Promise.all([
    prisma.article
      .aggregate({ where: { deletedAt: null }, _sum: { viewCount: true } })
      .then(r => r._sum.viewCount ?? 0).catch(() => 0),
    prisma.article.count({ where: { status: 'PUBLISHED', deletedAt: null } }).catch(() => 0),
    prisma.subscriber.count().catch(() => 0),
    prisma.subscriber.count({ where: { subscribedAt: { gte: since } } }).catch(() => 0),
    prisma.subscriber.count({ where: { subscribedAt: { gte: prevSince, lt: since } } }).catch(() => 0),
    prisma.articleView.count({ where: { viewedAt: { gte: since } } }).catch(() => 0),
    prisma.articleView.count({ where: { viewedAt: { gte: prevSince, lt: since } } }).catch(() => 0),
    prisma.articleView
      .findMany({ where: { viewedAt: { gte: since } }, select: { viewedAt: true } })
      .catch(() => [] as { viewedAt: Date }[]),
    prisma.article
      .findMany({
        where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { gte: since } },
        select: { publishedAt: true },
      })
      .catch(() => [] as { publishedAt: Date | null }[]),
  ])

  const viewsChange =
    viewsInPrevPeriod > 0
      ? Math.round(((viewsInPeriod - viewsInPrevPeriod) / viewsInPrevPeriod) * 100)
      : null
  const subscriberChange =
    subscribersInPrevPeriod > 0
      ? Math.round(((subscribersInPeriod - subscribersInPrevPeriod) / subscribersInPrevPeriod) * 100)
      : null

  // Build time-series buckets in JS
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
    let key: string, label: string
    if (period === '24h') {
      const d = subHours(now, bucketCount - 1 - i)
      key = format(d, 'yyyy-MM-dd HH:00'); label = format(d, 'HH:mm')
    } else {
      const d = subDays(now, bucketCount - 1 - i)
      key = format(d, 'yyyy-MM-dd'); label = format(d, 'd MMM')
    }
    return { label, views: trafficMap.get(key) ?? 0, published: publishMap.get(key) ?? 0 }
  })

  return NextResponse.json({
    summary: {
      viewsInPeriod, viewsChange,
      totalViews: totalViewsResult,
      totalPublished,
      subscriberCount,
      subscribersInPeriod,
      subscriberChange,
    },
    trafficData,
  })
}

async function handleContent(now: Date, since: Date) {
  // ── Top articles all time ──
  const topArticles = await prisma.article.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    orderBy: { viewCount: 'desc' },
    take: 10,
    select: {
      id: true, title: true, viewCount: true, publishedAt: true,
      author: { select: { name: true } },
      category: { select: { name: true } },
    },
  }).catch(() => [])

  // ── Article velocity (views in first 48h) ──
  const recentlyPublished = await prisma.article.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { gte: since } },
    select: {
      id: true, title: true, publishedAt: true, viewCount: true,
      author: { select: { name: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: 30,
  }).catch(() => [])

  const velocityArticleIds = recentlyPublished.map(a => a.id)
  const velocityViews = velocityArticleIds.length > 0
    ? await prisma.articleView.findMany({
        where: { articleId: { in: velocityArticleIds } },
        select: { articleId: true, viewedAt: true },
      }).catch(() => [])
    : []

  const velocityData = recentlyPublished
    .map(article => {
      if (!article.publishedAt) return null
      const pub = new Date(article.publishedAt)
      const cutoff = new Date(pub.getTime() + 48 * 60 * 60 * 1000)
      const first48hViews = velocityViews.filter(
        v => v.articleId === article.id &&
             new Date(v.viewedAt) >= pub &&
             new Date(v.viewedAt) < cutoff,
      ).length
      return { id: article.id, title: article.title, publishedAt: article.publishedAt, first48hViews, authorName: article.author?.name ?? null }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.first48hViews - a.first48hViews)
    .slice(0, 10)

  // ── Underperforming: published >7 days ago with 0 views ──
  const sevenDaysAgo = subDays(now, 7)
  const underperforming = await prisma.article.findMany({
    where: {
      status: 'PUBLISHED', deletedAt: null,
      publishedAt: { lte: sevenDaysAgo },
      viewCount: 0,
    },
    select: {
      id: true, title: true, publishedAt: true,
      author: { select: { name: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: 10,
  }).catch(() => [])

  // ── Best publish time slots (last 90 days for enough data) ──
  const slotArticles = await prisma.article.findMany({
    where: {
      status: 'PUBLISHED', deletedAt: null,
      publishedAt: { gte: subDays(now, 90) },
    },
    select: { id: true, publishedAt: true },
    take: 200,
  }).catch(() => [])

  const slotIds = slotArticles.map(a => a.id)
  const slotViews = slotIds.length > 0
    ? await prisma.articleView.findMany({
        where: { articleId: { in: slotIds } },
        select: { articleId: true, viewedAt: true },
      }).catch(() => [])
    : []

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const slotMap = new Map<string, { total: number; count: number }>()
  for (const article of slotArticles) {
    if (!article.publishedAt) continue
    const pub = new Date(article.publishedAt)
    const key = `${pub.getDay()}-${pub.getHours()}`
    const cutoff = new Date(pub.getTime() + 24 * 60 * 60 * 1000)
    const dayViews = slotViews.filter(
      v => v.articleId === article.id &&
           new Date(v.viewedAt) >= pub &&
           new Date(v.viewedAt) < cutoff,
    ).length
    const ex = slotMap.get(key) ?? { total: 0, count: 0 }
    slotMap.set(key, { total: ex.total + dayViews, count: ex.count + 1 })
  }

  const bestPublishSlots = Array.from(slotMap.entries())
    .map(([key, { total, count }]) => {
      const [day, hour] = key.split('-').map(Number)
      const h = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`
      return { label: `${DAYS[day]} at ${h}`, avgViews: count > 0 ? Math.round(total / count) : 0, count }
    })
    .filter(s => s.count >= 2)
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 5)

  // ── Category performance with completion rates ──
  const categories = await prisma.category.findMany({
    include: {
      articles: {
        where: { status: 'PUBLISHED', deletedAt: null },
        select: { viewCount: true, id: true },
      },
    },
  }).catch(() => [])

  // ── Completion rates per article ──
  const completionRaw = await prisma.readingProgress.groupBy({
    by: ['articleId'],
    _avg: { progress: true },
    _count: true,
    orderBy: { _avg: { progress: 'desc' } },
    take: 20,
  }).catch(() => [] as { articleId: string; _avg: { progress: number | null }; _count: number }[])

  const completionIds = completionRaw.map(c => c.articleId)
  const completionArticles = completionIds.length > 0
    ? await prisma.article.findMany({
        where: { id: { in: completionIds }, deletedAt: null },
        select: { id: true, title: true, author: { select: { name: true } } },
      }).catch(() => [])
    : []

  const completionRates = completionRaw.map(c => {
    const article = completionArticles.find(a => a.id === c.articleId)
    return {
      id: c.articleId,
      title: article?.title ?? 'Unknown',
      authorName: article?.author?.name ?? null,
      avgProgress: Math.round(c._avg.progress ?? 0),
      readerCount: c._count,
    }
  })

  // Build completion lookup for category averages
  const progressLookup = new Map(completionRaw.map(c => [c.articleId, c._avg.progress ?? 0]))
  const categoryPerformance = categories
    .map(cat => {
      const totalViews = cat.articles.reduce((sum, a) => sum + a.viewCount, 0)
      const avgViews = cat.articles.length > 0 ? Math.round(totalViews / cat.articles.length) : 0
      const withProgress = cat.articles.filter(a => progressLookup.has(a.id))
      const avgCompletion =
        withProgress.length > 0
          ? Math.round(withProgress.reduce((s, a) => s + (progressLookup.get(a.id) ?? 0), 0) / withProgress.length)
          : null
      return { name: cat.name, totalViews, articles: cat.articles.length, avgViews, avgCompletion }
    })
    .filter(c => c.articles > 0)
    .sort((a, b) => b.totalViews - a.totalViews)

  return NextResponse.json({
    topArticles, velocityData, underperforming,
    bestPublishSlots, categoryPerformance, completionRates,
  })
}

async function handleAudience(now: Date, since: Date, prevSince: Date) {
  // ── Return visitor rate by sessionHash ──
  const currentSessionGroups = await prisma.articleView.groupBy({
    by: ['sessionHash'],
    where: { viewedAt: { gte: since }, sessionHash: { not: null } },
  }).catch(() => [] as { sessionHash: string | null }[])
  const currentHashes = currentSessionGroups
    .map(s => s.sessionHash)
    .filter((s): s is string => Boolean(s))

  let returningCount = 0
  if (currentHashes.length > 0) {
    const returningRaw = await prisma.articleView.groupBy({
      by: ['sessionHash'],
      where: {
        viewedAt: { lt: since },
        sessionHash: { in: currentHashes.slice(0, 500) },
      },
    }).catch(() => [])
    const returningHashes = new Set(returningRaw.map(r => r.sessionHash))
    returningCount = currentHashes.filter(h => returningHashes.has(h)).length
  }
  const totalSessions = currentHashes.length
  const returnRate = totalSessions > 0 ? Math.round((returningCount / totalSessions) * 100) : 0
  const newCount = totalSessions - returningCount

  // Previous period return rate for trend
  const prevSessionGroups = await prisma.articleView.groupBy({
    by: ['sessionHash'],
    where: { viewedAt: { gte: prevSince, lt: since }, sessionHash: { not: null } },
  }).catch(() => [] as { sessionHash: string | null }[])
  const prevHashes = prevSessionGroups.map(s => s.sessionHash).filter((s): s is string => Boolean(s))
  let prevReturningCount = 0
  if (prevHashes.length > 0) {
    const prevReturningRaw = await prisma.articleView.groupBy({
      by: ['sessionHash'],
      where: { viewedAt: { lt: prevSince }, sessionHash: { in: prevHashes.slice(0, 500) } },
    }).catch(() => [])
    const prevReturningHashes = new Set(prevReturningRaw.map(r => r.sessionHash))
    prevReturningCount = prevHashes.filter(h => prevReturningHashes.has(h)).length
  }
  const prevReturnRate = prevHashes.length > 0
    ? Math.round((prevReturningCount / prevHashes.length) * 100)
    : 0
  const returnRateTrend = returnRate - prevReturnRate

  // ── Subscriber growth (last 12 weeks) ──
  const twelveWeeksAgo = subWeeks(now, 12)
  const recentSubs = await prisma.subscriber.findMany({
    where: { subscribedAt: { gte: twelveWeeksAgo } },
    select: { subscribedAt: true },
    orderBy: { subscribedAt: 'asc' },
  }).catch(() => [])

  const weeklyMap = new Map<string, number>()
  for (const s of recentSubs) {
    const weekKey = format(startOfWeek(new Date(s.subscribedAt), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    weeklyMap.set(weekKey, (weeklyMap.get(weekKey) ?? 0) + 1)
  }
  const subscriberGrowth = Array.from({ length: 12 }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(now, 11 - i), { weekStartsOn: 1 })
    const key = format(weekStart, 'yyyy-MM-dd')
    return { week: format(weekStart, 'd MMM'), count: weeklyMap.get(key) ?? 0 }
  })

  // ── Subscriber to reader ratio ──
  const [totalSubscribers, uniqueReaderGroups] = await Promise.all([
    prisma.subscriber.count().catch(() => 0),
    prisma.articleView.groupBy({
      by: ['sessionHash'],
      where: { viewedAt: { gte: since }, sessionHash: { not: null } },
    }).then(r => r.length).catch(() => 0),
  ])
  const subscriberRatio =
    uniqueReaderGroups > 0
      ? Math.round((totalSubscribers / uniqueReaderGroups) * 100) / 100
      : null

  // ── Most bookmarked articles ──
  const bookmarkGroups = await prisma.bookmark.groupBy({
    by: ['articleId'],
    _count: { articleId: true },
    orderBy: { _count: { articleId: 'desc' } },
    take: 10,
  }).catch(() => [])
  const bookmarkIds = bookmarkGroups.map(b => b.articleId)
  const bookmarkArticles = bookmarkIds.length > 0
    ? await prisma.article.findMany({
        where: { id: { in: bookmarkIds }, deletedAt: null },
        select: { id: true, title: true, author: { select: { name: true } }, category: { select: { name: true } } },
      }).catch(() => [])
    : []
  const mostBookmarked = bookmarkGroups.map(b => {
    const article = bookmarkArticles.find(a => a.id === b.articleId)
    return {
      id: b.articleId,
      title: article?.title ?? 'Unknown',
      authorName: article?.author?.name ?? null,
      category: article?.category?.name ?? null,
      count: b._count.articleId,
    }
  })

  return NextResponse.json({
    returnVisitorRate: { rate: returnRate, newCount, returningCount, trend: returnRateTrend },
    subscriberGrowth, subscriberRatio, totalSubscribers, uniqueReaders: uniqueReaderGroups,
    mostBookmarked,
  })
}

async function handleEngagement(since: Date, prevSince: Date) {
  // ── Articles with comment rates ──
  const articlesWithComments = await prisma.article.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true, title: true, viewCount: true,
      category: { select: { name: true } },
      _count: { select: { comments: { where: { isHidden: false } } } },
    },
    orderBy: { viewCount: 'desc' },
    take: 50,
  }).catch(() => [])

  const commentRates = articlesWithComments
    .filter(a => a.viewCount > 0)
    .map(a => ({
      id: a.id, title: a.title, category: a.category?.name ?? null,
      views: a.viewCount, comments: a._count.comments,
      commentRate: parseFloat(((a._count.comments / Math.max(a.viewCount, 1)) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.commentRate - a.commentRate)
    .slice(0, 10)

  const mostDiscussed = [...articlesWithComments]
    .sort((a, b) => b._count.comments - a._count.comments)
    .slice(0, 10)
    .map(a => ({
      id: a.id, title: a.title, viewCount: a.viewCount,
      category: a.category?.name ?? null, commentCount: a._count.comments,
    }))

  // ── Debate participation ──
  const debates = await prisma.debate.findMany({
    include: { _count: { select: { votes: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  }).catch(() => [])
  const totalViewsInPeriod = await prisma.articleView
    .count({ where: { viewedAt: { gte: since } } })
    .catch(() => 1)

  const debateParticipation = await Promise.all(
    debates.map(async d => {
      const counts = await prisma.debateVote.groupBy({
        by: ['side'], where: { debateId: d.id }, _count: { side: true },
      }).catch(() => [])
      const forCount = counts.find(c => c.side === 'FOR')?._count.side ?? 0
      const againstCount = counts.find(c => c.side === 'AGAINST')?._count.side ?? 0
      const total = forCount + againstCount
      return {
        title: d.title, totalVotes: total,
        forPct: total > 0 ? Math.round((forCount / total) * 100) : 50,
        againstPct: total > 0 ? Math.round((againstCount / total) * 100) : 50,
        voteRate: totalViewsInPeriod > 0
          ? parseFloat(((total / totalViewsInPeriod) * 100).toFixed(2)) : 0,
      }
    }),
  ).catch(() => [])

  // ── Upvote trend ──
  const [currentUpvotes, prevUpvotes] = await Promise.all([
    prisma.comment.aggregate({ where: { createdAt: { gte: since } }, _sum: { upvotes: true } })
      .then(r => r._sum.upvotes ?? 0).catch(() => 0),
    prisma.comment.aggregate({ where: { createdAt: { gte: prevSince, lt: since } }, _sum: { upvotes: true } })
      .then(r => r._sum.upvotes ?? 0).catch(() => 0),
  ])
  const upvoteChange = prevUpvotes > 0
    ? Math.round(((currentUpvotes - prevUpvotes) / prevUpvotes) * 100)
    : null

  // ── Most saved ──
  const savedGroups = await prisma.bookmark.groupBy({
    by: ['articleId'], _count: { articleId: true },
    orderBy: { _count: { articleId: 'desc' } }, take: 10,
  }).catch(() => [])
  const savedIds = savedGroups.map(b => b.articleId)
  const savedArticles = savedIds.length > 0
    ? await prisma.article.findMany({
        where: { id: { in: savedIds }, deletedAt: null },
        select: { id: true, title: true, author: { select: { name: true } } },
      }).catch(() => [])
    : []
  const mostSaved = savedGroups.map(b => {
    const a = savedArticles.find(x => x.id === b.articleId)
    return { id: b.articleId, title: a?.title ?? 'Unknown', authorName: a?.author?.name ?? null, count: b._count.articleId }
  })

  return NextResponse.json({
    commentRates, mostDiscussed, debateParticipation,
    upvoteTrend: { current: currentUpvotes, previous: prevUpvotes, change: upvoteChange },
    mostSaved,
  })
}

async function handleLeaderboard() {
  // The writer leaderboard ranks contributors by their full published body of
  // work — like the all-time "top articles" list, NOT scoped to the selected
  // analytics period. Scoping it to `publishedAt >= since` (default 30 days)
  // was the bug: a publication that posts less than monthly showed "No
  // writers…" even though every writer has recent published articles.
  const writers = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
    select: {
      id: true, name: true, email: true,
      articles: {
        where: { status: 'PUBLISHED', deletedAt: null },
        select: {
          id: true, viewCount: true, content: true,
          _count: { select: { comments: { where: { isHidden: false } } } },
        },
      },
    },
  }).catch(() => [])

  const allArticleIds = writers.flatMap(w => w.articles.map(a => a.id))
  const progressGroups = allArticleIds.length > 0
    ? await prisma.readingProgress.groupBy({
        by: ['articleId'],
        where: { articleId: { in: allArticleIds } },
        _avg: { progress: true },
      }).catch(() => [] as { articleId: string; _avg: { progress: number | null } }[])
    : []
  const progressMap = new Map(progressGroups.map(p => [p.articleId, p._avg.progress ?? 0]))

  const leaderboard = writers
    .filter(w => w.articles.length > 0)
    .map(writer => {
      const totalReadingMinutes = writer.articles.reduce((sum, a) => {
        return sum + estimateReadingMinutes(a.content, progressMap.get(a.id) ?? 0)
      }, 0)
      const avgCompletionRate =
        Math.round(writer.articles.reduce((s, a) => s + (progressMap.get(a.id) ?? 0), 0) / writer.articles.length)
      const totalViews = writer.articles.reduce((s, a) => s + a.viewCount, 0)
      const avgViewsPerArticle = Math.round(totalViews / writer.articles.length)
      const commentsGenerated = writer.articles.reduce((s, a) => s + a._count.comments, 0)
      return {
        id: writer.id,
        name: writer.name ?? writer.email ?? 'Unknown',
        articlesCount: writer.articles.length,
        totalReadingMinutes: Math.round(totalReadingMinutes * 10) / 10,
        avgCompletionRate,
        avgViewsPerArticle,
        commentsGenerated,
      }
    })
    .sort((a, b) => b.totalReadingMinutes - a.totalReadingMinutes)
    .map((w, i) => ({ ...w, rank: i + 1 }))

  return NextResponse.json({ writers: leaderboard })
}

async function handleDistribution() {
  const [allViewSources, recentActivity] = await Promise.all([
    prisma.articleView.findMany({ select: { source: true } })
      .catch(() => [] as { source: string | null }[]),
    prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      orderBy: { publishedAt: 'desc' },
      take: 10,
      select: {
        id: true, title: true, publishedAt: true, viewCount: true,
        author: { select: { name: true } },
        category: { select: { name: true } },
      },
    }).catch(() => []),
  ])

  const SOURCE_ORDER = ['Direct', 'Search', 'Social', 'Email', 'Other'] as const
  const sourceMap = new Map<string, number>()
  for (const v of allViewSources) {
    const s = v.source ?? 'Direct'
    sourceMap.set(s, (sourceMap.get(s) ?? 0) + 1)
  }
  const total = allViewSources.length || 1
  const trafficSources = SOURCE_ORDER
    .filter(s => sourceMap.has(s) || s === 'Direct')
    .map(s => ({
      source: s,
      views: sourceMap.get(s) ?? 0,
      pct: Math.round(((sourceMap.get(s) ?? 0) / total) * 100),
    }))

  return NextResponse.json({ trafficSources, recentActivity })
}
