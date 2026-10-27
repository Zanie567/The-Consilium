import { prisma } from '@/lib/prisma'

// A stable comparison of two complete seven-day UTC windows, excluding today.
const DAY_MS = 86400000
const PUBLIC_LAUNCH = Date.parse('2026-10-23T12:00:00Z')
const PAGE_TRACKING_START = new Date('2026-10-27T14:30:00Z')

export function growthDelta(current: number, previous: number, comparable: boolean): number | null {
  return comparable && previous > 0 ? Math.round((current - previous) / previous * 100) : null
}

export async function getWeeklyGrowthReview(now = new Date()) {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const currentStart = new Date(midnight.getTime() - 7 * DAY_MS)
  const previousStart = new Date(midnight.getTime() - 14 * DAY_MS)

  const [articleCurrent, articlePrevious, pageCurrent, pagePrevious,
    confirmedCurrent, confirmedPrevious, taggedArticles, taggedPages, topGroups] =
    await Promise.all([
      prisma.articleView.count({ where: { viewedAt: { gte: currentStart, lt: midnight } } }),
      prisma.articleView.count({ where: { viewedAt: { gte: previousStart, lt: currentStart } } }),
      prisma.siteView.count({ where: { viewedAt: { gte: new Date(Math.max(currentStart.getTime(), PAGE_TRACKING_START.getTime())), lt: midnight } } }),
      prisma.siteView.count({ where: { viewedAt: { gte: new Date(Math.max(previousStart.getTime(), PAGE_TRACKING_START.getTime())), lt: currentStart } } }),
      prisma.subscriber.count({ where: { status: 'ACTIVE', confirmedAt: { gte: currentStart, lt: midnight } } }),
      prisma.subscriber.count({ where: { status: 'ACTIVE', confirmedAt: { gte: previousStart, lt: currentStart } } }),
      prisma.articleView.count({ where: { viewedAt: { gte: currentStart, lt: midnight }, entryKind: 'entry', campaignName: { not: null } } }),
      prisma.siteView.count({ where: { viewedAt: { gte: currentStart, lt: midnight }, entryKind: 'entry', campaignName: { not: null } } }),
      prisma.articleView.groupBy({
        by: ['articleId'],
        where: { viewedAt: { gte: currentStart, lt: midnight } },
        _count: { _all: true },
        orderBy: { _count: { articleId: 'desc' } },
        take: 5,
      }),
    ])
  const articles = topGroups.length ? await prisma.article.findMany({
    where: { id: { in: topGroups.map(g => g.articleId) }, deletedAt: null, status: 'PUBLISHED' },
    select: { id: true, title: true, slug: true },
  }) : []
  const articleLookup = new Map(articles.map(a => [a.id, a]))
  const topArticles = topGroups.flatMap(group => {
    const article = articleLookup.get(group.articleId)
    return article ? [{ id: article.id, title: article.title, slug: article.slug,
      views: group._count._all }] : []
  })
  const taggedLandings = taggedArticles + taggedPages
  const articleComparable = previousStart.getTime() >= PUBLIC_LAUNCH
  const siteComparable = previousStart >= PAGE_TRACKING_START
  const currentPageViews = articleCurrent + pageCurrent
  const previousPageViews = articlePrevious + pagePrevious
  const priorities: string[] = []
  if (!taggedLandings)
    priorities.push('Use separately tagged links for the next Instagram, LinkedIn and society promotions to identify what brings readers.')
  if (!confirmedCurrent)
    priorities.push('Review the newsletter sign-up and confirmation journey: no new currently active confirmations were recorded in this period.')
  if (topArticles[0] && articleCurrent > 0 && topArticles[0].views / articleCurrent >= 0.5)
    priorities.push('One article accounts for at least half of recorded article views. Test another headline or subject alongside it before drawing broader editorial conclusions.')
  if (!priorities.length)
    priorities.push('Review the leading article and campaign sources, then repeat the most promising distribution experiment next week.')

  return {
    startDate: currentStart.toISOString().slice(0, 10),
    endDate: new Date(midnight.getTime() - DAY_MS).toISOString().slice(0, 10),
    basis: 'Seven complete UTC days, excluding today',
    historicalWarning: !articleComparable
      ? 'The comparison window includes pre-launch activity. Growth percentages are withheld until two comparable post-launch weeks exist.'
      : null,
    current: {
      articleViews: articleCurrent, sitePageViews: currentPageViews,
      taggedLandings, newConfirmedActiveSubscribers: confirmedCurrent,
    },
    previous: {
      articleViews: articlePrevious, sitePageViews: previousPageViews,
      newConfirmedActiveSubscribers: confirmedPrevious,
    },
    changes: {
      articleViews: growthDelta(articleCurrent, articlePrevious, articleComparable),
      sitePageViews: growthDelta(currentPageViews, previousPageViews, siteComparable),
      subscribers: growthDelta(confirmedCurrent, confirmedPrevious, articleComparable),
    },
    topArticles, priorities,
  }
}
