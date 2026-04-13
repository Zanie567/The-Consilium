import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format, formatDistanceToNow, subDays } from 'date-fns'
import type { Metadata } from 'next'
import { TrafficChart } from './TrafficChart'

export const metadata: Metadata = {
  title: 'Analytics | Editorial',
  robots: { index: false, follow: false },
}

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    redirect('/editorial')
  }

  const thirtyDaysAgo = subDays(new Date(), 30)
  const sevenDaysAgo = subDays(new Date(), 7)

  const [
    totalViewsResult,
    totalPublished,
    totalUsers,
    newThisWeek,
    topArticles,
    categories,
    authors,
    recentActivity,
    trafficByDay,
  ] = await Promise.all([
    prisma.article
      .aggregate({ _sum: { viewCount: true } })
      .then((r) => r._sum.viewCount ?? 0)
      .catch(() => 0),

    prisma.article.count({ where: { status: 'PUBLISHED' } }).catch(() => 0),

    prisma.user.count().catch(() => 0),

    prisma.article
      .count({ where: { status: 'PUBLISHED', publishedAt: { gte: sevenDaysAgo } } })
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

    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "viewedAt") as day, COUNT(*) as count
      FROM article_views
      WHERE "viewedAt" >= ${thirtyDaysAgo}
      GROUP BY DATE_TRUNC('day', "viewedAt")
      ORDER BY day ASC
    `.catch(() => [] as { day: Date; count: bigint }[]),
  ])

  // Build 30-day chart data
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const d = subDays(new Date(), 29 - i)
    return format(d, 'yyyy-MM-dd')
  })
  const trafficMap = new Map(
    trafficByDay.map((r) => [format(new Date(r.day), 'yyyy-MM-dd'), Number(r.count)])
  )
  const chartData = last30Days.map((day) => ({
    label: format(new Date(day + 'T12:00:00'), 'd MMM'),
    value: trafficMap.get(day) ?? 0,
  }))

  // Category breakdown
  const categoryData = categories
    .map((cat) => ({
      name: cat.name,
      views: cat.articles.reduce((sum, a) => sum + a.viewCount, 0),
      articles: cat.articles.length,
    }))
    .filter((c) => c.views > 0)
    .sort((a, b) => b.views - a.views)

  const maxCategoryViews = Math.max(...categoryData.map((c) => c.views), 1)

  // Author leaderboard
  const authorData = authors
    .map((u) => ({
      name: u.name ?? u.email ?? 'Unknown',
      articles: u.articles.length,
      views: u.articles.reduce((sum, a) => sum + a.viewCount, 0),
    }))
    .filter((a) => a.articles > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10)

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Analytics
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          Site performance, readership, and content insights.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Views" value={totalViewsResult.toLocaleString()} />
        <StatCard label="Published Articles" value={totalPublished} accent="emerald" />
        <StatCard label="Total Users" value={totalUsers} />
        <StatCard
          label="Published This Week"
          value={newThisWeek}
          accent={newThisWeek > 0 ? 'gold' : undefined}
        />
      </div>

      {/* Traffic over time */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] mb-6">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
            Traffic — Last 30 Days
          </h2>
        </div>
        <div className="p-6">
          <TrafficChart data={chartData} />
        </div>
      </div>

      {/* Top articles + views by category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top articles */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              Top Articles by Views
            </h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {topArticles.length > 0 ? (
              topArticles.map((article, i) => (
                <div
                  key={article.id}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors"
                >
                  <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/editorial/articles/${article.id}/edit`}
                      className="text-sm font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1"
                    >
                      {article.title}
                    </Link>
                    <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                      {article.author.name} · {article.category?.name ?? 'Uncategorised'}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-sm font-bold text-[var(--fg)]"
                    style={{ fontFamily: 'var(--font-serif)' }}
                  >
                    {article.viewCount.toLocaleString()}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">
                No published articles yet.
              </div>
            )}
          </div>
        </div>

        {/* Views by category */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]">
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              Views by Category
            </h2>
          </div>
          <div className="p-6 space-y-5">
            {categoryData.length > 0 ? (
              categoryData.map((cat) => (
                <div key={cat.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-[var(--fg)]">{cat.name}</span>
                    <span
                      className="text-sm font-bold text-[var(--fg)]"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {cat.views.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-subtle)] overflow-hidden">
                    <div
                      className="h-full bg-gold transition-all"
                      style={{ width: `${(cat.views / maxCategoryViews) * 100}%` }}
                    />
                  </div>
                  <p className="text-[var(--fg-faint)] text-xs mt-1">{cat.articles} articles</p>
                </div>
              ))
            ) : (
              <p className="text-[var(--fg-faint)] text-sm">No category data yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Author leaderboard */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
            Author Leaderboard
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-6 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                  #
                </th>
                <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                  Author
                </th>
                <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                  Articles
                </th>
                <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                  Total Views
                </th>
                <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">
                  Avg / Article
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {authorData.length > 0 ? (
                authorData.map((author, i) => (
                  <tr key={author.name} className="hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="px-6 py-3 text-[var(--fg-faint)] text-xs font-bold">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-[var(--fg)]">{author.name}</td>
                    <td className="px-4 py-3 text-right text-[var(--fg-muted)] text-xs">
                      {author.articles}
                    </td>
                    <td
                      className="px-4 py-3 text-right font-bold text-[var(--fg)]"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {author.views.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs hidden sm:table-cell">
                      {Math.round(author.views / author.articles).toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">
                    No author data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traffic sources + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Traffic sources */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]">
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              Traffic Sources
            </h2>
          </div>
          <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
            <p className="text-[var(--fg-muted)] text-sm mb-1">Referrer tracking not yet enabled.</p>
            <p className="text-[var(--fg-faint)] text-xs">
              Add a referrer field to ArticleView to enable source attribution.
            </p>
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              Recent Activity
            </h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {recentActivity.length > 0 ? (
              recentActivity.map((article) => (
                <div
                  key={article.id}
                  className="flex items-start gap-3 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/editorial/articles/${article.id}/edit`}
                      className="text-sm font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1"
                    >
                      {article.title}
                    </Link>
                    <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                      {article.author.name} · {article.category?.name ?? 'Uncategorised'}
                      {article.publishedAt
                        ? ` · published ${formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}`
                        : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--fg-faint)]">
                    {article.viewCount.toLocaleString()} views
                  </span>
                </div>
              ))
            ) : (
              <div className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">
                No activity yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: 'emerald' | 'amber' | 'gold'
}) {
  const valueClass =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : accent === 'gold'
      ? 'text-gold'
      : 'text-[var(--fg)]'

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
      <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-2">{label}</p>
      <p
        className={`text-3xl font-bold ${valueClass}`}
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {value}
      </p>
    </div>
  )
}
