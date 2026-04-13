'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  BarController,
  BarElement,
  Tooltip,
  Filler,
} from 'chart.js'
import type { Metadata } from 'next'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  BarController,
  BarElement,
  Tooltip,
  Filler,
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Summary {
  total_views_all_time: number
  views_today: number
  views_today_change: number | null
  views_this_week: number
  views_this_week_change: number | null
  views_this_month: number
  views_this_month_change: number | null
  total_articles_published: number
  total_authors: number
  avg_views_per_article: number
}

interface TimeseriesPoint { date: string; views: number }

interface TopArticle {
  rank: number
  article_id: string
  title: string
  slug: string | null
  author: string | null
  category: string | null
  views: number
  views_last_period: number
  trend: 'up' | 'down' | 'same'
}

interface CategoryStat { category: string; views: number; percentage_of_total: number }

interface AuthorStat {
  rank: number
  author_id: string
  author_name: string
  total_articles: number
  total_views: number
  avg_views_per_article: number
  most_viewed_article: { title: string; slug: string; views: number } | null
}

interface ReferrerStat { referrer: string; views: number; percentage: number }

interface RecentView { article_title: string; article_slug: string; viewed_at: string; referrer: string | null }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOLD = '#c9a227'
const GOLD_20 = 'rgba(201,162,39,0.2)'
const GOLD_70 = 'rgba(201,162,39,0.7)'
const NAVY = '#1a2744'

function fmt(n: number): string {
  return n.toLocaleString()
}

function referrerLabel(r: string | null): string {
  if (!r) return 'Direct'
  try {
    const host = new URL(r).hostname.replace(/^www\./, '')
    if (host.includes('google')) return 'Google'
    if (host.includes('twitter') || host.includes('t.co') || host.includes('x.com')) return 'Twitter / X'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('facebook')) return 'Facebook'
    return host || 'Other'
  } catch {
    return 'Other'
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--border)] rounded ${className ?? ''}`} />
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-10 text-center text-[var(--fg-faint)] text-sm italic">
      {message}
    </div>
  )
}

function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null
  if (pct === 0) return <span className="text-[var(--fg-faint)] text-xs">→ 0%</span>
  if (pct > 0)
    return <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">▲ {pct}%</span>
  return <span className="text-red-500 dark:text-red-400 text-xs font-semibold">▼ {Math.abs(pct)}%</span>
}

function SummaryCards({ summary }: { summary: Summary | null }) {
  const cards = summary
    ? [
        { label: 'Total views', value: fmt(summary.total_views_all_time), change: null },
        { label: 'Views today', value: fmt(summary.views_today), change: summary.views_today_change },
        { label: 'Views this week', value: fmt(summary.views_this_week), change: summary.views_this_week_change },
        { label: 'Views this month', value: fmt(summary.views_this_month), change: summary.views_this_month_change },
        { label: 'Articles published', value: fmt(summary.total_articles_published), change: null },
        { label: 'Avg views / article', value: fmt(summary.avg_views_per_article), change: null },
      ]
    : Array.from({ length: 6 }, (_, i) => ({ label: '', value: '', change: null, loading: true }))

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
      {cards.map((card, i) =>
        (card as { loading?: boolean }).loading ? (
          <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 shadow-[var(--shadow-card)]">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-7 w-12" />
          </div>
        ) : (
          <div key={card.label} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 shadow-[var(--shadow-card)]">
            <p className="text-[var(--fg-faint)] text-[10px] uppercase tracking-widest mb-1.5">{card.label}</p>
            <p className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
              {card.value}
            </p>
            {card.change !== null && <TrendBadge pct={card.change} />}
          </div>
        ),
      )}
    </div>
  )
}

function TimeseriesChart({ data, loading }: { data: TimeseriesPoint[]; loading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (loading || !data.length) return
    const ctx = canvasRef.current
    if (!ctx) return
    if (chartRef.current) chartRef.current.destroy()

    const labels = data.map((d) =>
      new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    )

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: data.map((d) => d.views),
            borderColor: GOLD,
            backgroundColor: GOLD_20,
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: GOLD,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (items) => labels[items[0].dataIndex],
          label: (item) => ` ${fmt(item.parsed.y ?? 0)} views`,
        }}},
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(26,39,68,0.4)', maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(26,39,68,0.06)' }, ticks: { color: 'rgba(26,39,68,0.4)', callback: (v) => fmt(Number(v ?? 0)) }, beginAtZero: true },
        },
      },
    })
    return () => { chartRef.current?.destroy() }
  }, [data, loading])

  if (loading) return <Skeleton className="h-64 w-full" />
  if (!data.length) return <EmptyState message="No data yet — views will appear here as readers visit the site" />

  return <div className="relative h-64"><canvas ref={canvasRef} /></div>
}

function CategoryChart({ data, loading }: { data: CategoryStat[]; loading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (loading || !data.length) return
    const ctx = canvasRef.current
    if (!ctx) return
    if (chartRef.current) chartRef.current.destroy()

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.category),
        datasets: [{ data: data.map((d) => d.views), backgroundColor: GOLD_70, borderColor: GOLD, borderWidth: 1 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (item) => ` ${fmt(item.parsed.x ?? 0)} views`,
        }}},
        scales: {
          x: { grid: { color: 'rgba(26,39,68,0.06)' }, ticks: { color: 'rgba(26,39,68,0.4)', callback: (v) => fmt(Number(v ?? 0)) }, beginAtZero: true },
          y: { grid: { display: false }, ticks: { color: 'rgba(26,39,68,0.55)' } },
        },
      },
    })
    return () => { chartRef.current?.destroy() }
  }, [data, loading])

  if (loading) return <Skeleton className="h-48 w-full" />
  if (!data.length) return <EmptyState message="No data yet — views will appear here as readers visit the site" />

  return <div className="relative" style={{ height: `${Math.max(data.length * 36 + 20, 120)}px` }}><canvas ref={canvasRef} /></div>
}

// ---------------------------------------------------------------------------
// Sort helpers for top articles table
// ---------------------------------------------------------------------------

type SortKey = 'rank' | 'views' | 'views_last_period' | 'trend'

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [range, setRange] = useState<7 | 30 | 90 | 0>(30)

  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([])
  const [timeseriesLoading, setTimeseriesLoading] = useState(true)

  const [topArticles, setTopArticles] = useState<TopArticle[]>([])
  const [topLoading, setTopLoading] = useState(true)
  const [showAllArticles, setShowAllArticles] = useState(false)
  const [topSort, setTopSort] = useState<SortKey>('rank')
  const [topSortDir, setTopSortDir] = useState<1 | -1>(1)

  const [categories, setCategories] = useState<CategoryStat[]>([])
  const [catLoading, setCatLoading] = useState(true)

  const [authors, setAuthors] = useState<AuthorStat[]>([])
  const [authorLoading, setAuthorLoading] = useState(true)

  const [referrers, setReferrers] = useState<ReferrerStat[]>([])
  const [refLoading, setRefLoading] = useState(true)

  const [recent, setRecent] = useState<RecentView[]>([])
  const [recentLoading, setRecentLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const days = range === 0 ? 3650 : range
    setSummaryLoading(true)
    setTimeseriesLoading(true)
    setTopLoading(true)
    setCatLoading(true)
    setAuthorLoading(true)
    setRefLoading(true)

    const [sumRes, tsRes, topRes, catRes, authRes, refRes] = await Promise.all([
      fetch('/api/analytics/summary'),
      fetch(`/api/analytics/timeseries?days=${days}&granularity=day`),
      fetch(`/api/analytics/top-articles?limit=50&period=${days}`),
      fetch('/api/analytics/by-category'),
      fetch('/api/analytics/by-author'),
      fetch(`/api/analytics/referrers?days=${days}`),
    ])

    if (sumRes.ok) setSummary(await sumRes.json())
    setSummaryLoading(false)

    if (tsRes.ok) setTimeseries(await tsRes.json())
    setTimeseriesLoading(false)

    if (topRes.ok) setTopArticles(await topRes.json())
    setTopLoading(false)

    if (catRes.ok) setCategories(await catRes.json())
    setCatLoading(false)

    if (authRes.ok) setAuthors(await authRes.json())
    setAuthorLoading(false)

    if (refRes.ok) setReferrers(await refRes.json())
    setRefLoading(false)
  }, [range])

  const fetchRecent = useCallback(async () => {
    const res = await fetch('/api/analytics/recent-activity')
    if (res.ok) setRecent(await res.json())
    setRecentLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    fetchRecent()
    const id = setInterval(fetchRecent, 60_000)
    return () => clearInterval(id)
  }, [fetchRecent])

  // Sorted top articles
  const sortedTopArticles = [...topArticles].sort((a, b) => {
    if (topSort === 'trend') {
      const order = { up: 0, same: 1, down: 2 }
      return (order[a.trend] - order[b.trend]) * topSortDir
    }
    const av = a[topSort as keyof TopArticle] as number
    const bv = b[topSort as keyof TopArticle] as number
    return (av - bv) * topSortDir
  })

  const displayedArticles = showAllArticles ? sortedTopArticles : sortedTopArticles.slice(0, 10)

  function handleSort(key: SortKey) {
    if (topSort === key) {
      setTopSortDir((d) => (d === 1 ? -1 : 1))
    } else {
      setTopSort(key)
      setTopSortDir(key === 'rank' ? 1 : -1)
    }
  }

  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    const active = topSort === k
    return (
      <button
        onClick={() => handleSort(k)}
        className={`text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hover:text-gold transition-colors ${active ? 'text-gold' : ''}`}
      >
        {label}
        {active ? (topSortDir === -1 ? ' ↓' : ' ↑') : ''}
      </button>
    )
  }

  // ---------------------------------------------------------------------------
  // Range buttons
  // ---------------------------------------------------------------------------

  const rangeOptions: { label: string; value: 7 | 30 | 90 | 0 }[] = [
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
    { label: 'All', value: 0 },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Analytics
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">Site-wide readership data</p>
        </div>
        {/* Date range */}
        <div className="flex gap-1 bg-[var(--bg-subtle)] p-1 border border-[var(--border)]">
          {rangeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                range === opt.value
                  ? 'bg-gold text-navy'
                  : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section 1: Summary cards */}
      <SummaryCards summary={summaryLoading ? null : summary} />

      {/* Section 2: Traffic over time */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-6 mb-6">
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-5">Site traffic</h2>
        <TimeseriesChart data={timeseries} loading={timeseriesLoading} />
      </div>

      {/* Section 3: Top articles */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] mb-6 overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">Top articles</h2>
          {!topLoading && topArticles.length > 10 && (
            <button
              onClick={() => setShowAllArticles((s) => !s)}
              className="text-xs text-gold hover:underline"
            >
              {showAllArticles ? 'Show less' : `View all ${topArticles.length} →`}
            </button>
          )}
        </div>

        {topLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : topArticles.length === 0 ? (
          <EmptyState message="No data yet — views will appear here as readers visit the site" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-5 py-2.5 text-left w-8"><SortHeader label="#" k="rank" /></th>
                  <th className="px-4 py-2.5 text-left">Title</th>
                  <th className="px-4 py-2.5 text-left hidden md:table-cell text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Author</th>
                  <th className="px-4 py-2.5 text-left hidden lg:table-cell text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="Views" k="views" /></th>
                  <th className="px-4 py-2.5 text-right hidden sm:table-cell"><SortHeader label="This period" k="views_last_period" /></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader label="Trend" k="trend" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {displayedArticles.map((a) => (
                  <tr key={a.article_id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="px-5 py-3 text-[var(--fg-faint)] text-xs">{a.rank}</td>
                    <td className="px-4 py-3">
                      {a.slug ? (
                        <Link
                          href={`/articles/${a.slug}`}
                          target="_blank"
                          className="font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1"
                        >
                          {a.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-[var(--fg)] line-clamp-1">{a.title}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden md:table-cell">{a.author ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden lg:table-cell">{a.category ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--fg)] text-sm">{fmt(a.views)}</td>
                    <td className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs hidden sm:table-cell">{fmt(a.views_last_period)}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      {a.trend === 'up' && <span className="text-emerald-600 dark:text-emerald-400 font-bold">▲</span>}
                      {a.trend === 'down' && <span className="text-red-500 dark:text-red-400 font-bold">▼</span>}
                      {a.trend === 'same' && <span className="text-[var(--fg-faint)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 4 + 6 side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Section 4: Views by category */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-6">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-5">Views by category</h2>
          <CategoryChart data={categories} loading={catLoading} />
        </div>

        {/* Section 6: Traffic sources */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-6">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-5">Traffic sources</h2>
          {refLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : referrers.length === 0 ? (
            <EmptyState message="No data yet — views will appear here as readers visit the site" />
          ) : (
            <div className="space-y-2">
              {referrers.map((r) => (
                <div key={r.referrer} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-xs text-[var(--fg-muted)] truncate">{r.referrer}</div>
                  <div className="flex-1 bg-[var(--bg-subtle)] h-2 overflow-hidden">
                    <div className="h-full bg-gold" style={{ width: `${r.percentage}%` }} />
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-[var(--fg-faint)]">
                    {fmt(r.views)} <span className="text-[var(--fg-faint)/60]">({r.percentage}%)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Author leaderboard */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] mb-6 overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">Author leaderboard</h2>
        </div>
        {authorLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : authors.length === 0 ? (
          <EmptyState message="No data yet — views will appear here as readers visit the site" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-5 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider w-8">#</th>
                  <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Author</th>
                  <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">Articles</th>
                  <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Total views</th>
                  <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden md:table-cell">Avg / article</th>
                  <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden lg:table-cell">Best article</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {authors.map((a) => (
                  <tr key={a.author_id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="px-5 py-3 text-[var(--fg-faint)] text-xs">{a.rank}</td>
                    <td className="px-4 py-3 font-medium text-[var(--fg)]">{a.author_name}</td>
                    <td className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs hidden sm:table-cell">{fmt(a.total_articles)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--fg)] text-sm">{fmt(a.total_views)}</td>
                    <td className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs hidden md:table-cell">{fmt(a.avg_views_per_article)}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {a.most_viewed_article ? (
                        <Link
                          href={`/articles/${a.most_viewed_article.slug}`}
                          target="_blank"
                          className="text-xs text-[var(--fg-muted)] hover:text-gold transition-colors line-clamp-1"
                        >
                          {a.most_viewed_article.title}
                          <span className="text-[var(--fg-faint)] ml-1">({fmt(a.most_viewed_article.views)})</span>
                        </Link>
                      ) : (
                        <span className="text-[var(--fg-faint)] text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 7: Recent activity feed */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">Recent activity</h2>
          <span className="text-[var(--fg-faint)] text-[10px] uppercase tracking-widest">Refreshes every 60s</span>
        </div>
        {recentLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState message="No data yet — views will appear here as readers visit the site" />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {recent.slice(0, 20).map((v, i) => (
              <div key={i} className="flex items-center gap-3 px-6 py-3 hover:bg-[var(--bg-subtle)] transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[var(--fg-muted)]">Someone read </span>
                  <Link
                    href={`/articles/${v.article_slug}`}
                    target="_blank"
                    className="text-xs font-medium text-[var(--fg)] hover:text-gold transition-colors"
                  >
                    {v.article_title}
                  </Link>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-[var(--fg-faint)]">
                    {formatDistanceToNow(new Date(v.viewed_at), { addSuffix: true })}
                  </p>
                  {v.referrer && (
                    <p className="text-[10px] text-[var(--fg-faint)]">{referrerLabel(v.referrer)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
