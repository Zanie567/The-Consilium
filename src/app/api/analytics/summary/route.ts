import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

async function requireAdmin(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true, isBanned: true },
  })
  if (!user || !user.isActive || user.isBanned || user.role !== 'ADMIN') return null
  return session.user.id
}

export async function GET() {
  const userId = await requireAdmin()
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfThisWeek = new Date(startOfToday)
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay())
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const startOfLastWeek = new Date(startOfThisWeek)
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7)
  const endOfLastWeek = new Date(startOfThisWeek)

  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const yesterday = new Date(startOfToday)
  yesterday.setDate(yesterday.getDate() - 1)

  const [
    totalViewsAllTime,
    viewsToday,
    viewsThisWeek,
    viewsThisMonth,
    viewsYesterday,
    viewsLastWeek,
    viewsLastMonth,
    totalArticlesPublished,
    totalAuthors,
  ] = await Promise.all([
    prisma.articleView.count(),
    prisma.articleView.count({ where: { viewedAt: { gte: startOfToday } } }),
    prisma.articleView.count({ where: { viewedAt: { gte: startOfThisWeek } } }),
    prisma.articleView.count({ where: { viewedAt: { gte: startOfThisMonth } } }),
    prisma.articleView.count({ where: { viewedAt: { gte: yesterday, lt: startOfToday } } }),
    prisma.articleView.count({ where: { viewedAt: { gte: startOfLastWeek, lt: endOfLastWeek } } }),
    prisma.articleView.count({ where: { viewedAt: { gte: startOfLastMonth, lt: endOfLastMonth } } }),
    prisma.article.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    prisma.user.count({ where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } } }),
  ])

  const avgViewsPerArticle = totalArticlesPublished > 0
    ? Math.round(totalViewsAllTime / totalArticlesPublished)
    : 0

  function pct(current: number, previous: number): number | null {
    if (previous === 0) return null
    return Math.round(((current - previous) / previous) * 100)
  }

  return NextResponse.json({
    total_views_all_time: totalViewsAllTime,
    views_today: viewsToday,
    views_today_change: pct(viewsToday, viewsYesterday),
    views_this_week: viewsThisWeek,
    views_this_week_change: pct(viewsThisWeek, viewsLastWeek),
    views_this_month: viewsThisMonth,
    views_this_month_change: pct(viewsThisMonth, viewsLastMonth),
    total_articles_published: totalArticlesPublished,
    total_authors: totalAuthors,
    avg_views_per_article: avgViewsPerArticle,
  })
}
