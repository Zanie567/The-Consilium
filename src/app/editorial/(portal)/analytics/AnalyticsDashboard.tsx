'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Line, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Filler,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, TrendingUp, TrendingDown, Minus, BarChart2, Users } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip)

type Period = '24h' | '7d' | '30d' | '90d'

const PERIOD_LABELS: Record<Period, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}

const CATEGORY_COLORS = [
  '#c9a227',
  '#1a2744',
  '#4a7c59',
  '#8b4a2f',
  '#5b7fa6',
  '#9b7bb8',
  '#c06b6b',
  '#6b9b9b',
]

interface AnalyticsData {
  summary: {
    totalViews: number
    totalPublished: number
    totalUsers: number
    newInPeriod: number
    viewsInPeriod: number
    viewsChange: number | null
  }
  trafficData: { label: string; views: number; published: number }[]
  trafficSources: { source: string; views: number; pct: number }[]
  topArticles: {
    id: string
    title: string
    viewCount: number
    publishedAt: string | null
    author: { name: string | null }
    category: { name: string } | null
  }[]
  categoryData: { name: string; views: number; articles: number }[]
  authorData: { name: string; articles: number; views: number }[]
  recentActivity: {
    id: string
    title: string
    publishedAt: string | null
    viewCount: number
    author: { name: string | null }
    category: { name: string } | null
  }[]
}

// Stagger animation variants
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
}

export function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>('30d')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [key, setKey] = useState(0) // bump to re-trigger animations on period change
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/editorial/analytics?period=${p}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
        setKey((k) => k + 1)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(period)
  }, [period, fetchData])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectPeriod = (p: Period) => {
    setPeriod(p)
    setDropdownOpen(false)
  }

  const maxTopViews = Math.max(...(data?.topArticles.map((a) => a.viewCount) ?? [1]), 1)
  const maxAuthorViews = Math.max(...(data?.authorData.map((a) => a.views) ?? [1]), 1)

  // Line chart
  const lineChartData = {
    labels: data?.trafficData.map((d) => d.label) ?? [],
    datasets: [
      {
        label: 'Views',
        data: data?.trafficData.map((d) => d.views) ?? [],
        borderColor: '#c9a227',
        backgroundColor: 'rgba(201, 162, 39, 0.08)',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#c9a227',
        tension: 0.4,
        fill: true,
      },
    ],
  }

  const lineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: period === '90d' ? 4 : 3.2,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a2744',
        titleColor: '#c9a227',
        bodyColor: '#faf8f3',
        padding: 12,
        cornerRadius: 0,
        callbacks: {
          label: (item) => ` ${(item.raw as number).toLocaleString()} views`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: 'rgba(26,39,68,0.45)',
          font: { size: 10 },
          maxRotation: 0,
          maxTicksLimit: period === '24h' ? 12 : period === '90d' ? 12 : 10,
        },
        border: { display: false },
      },
      y: {
        grid: { color: 'rgba(26,39,68,0.06)' },
        ticks: {
          color: 'rgba(26,39,68,0.45)',
          font: { size: 10 },
          maxTicksLimit: 5,
        },
        border: { display: false },
        beginAtZero: true,
      },
    },
  }

  // Doughnut chart
  const doughnutChartData = {
    labels: data?.categoryData.map((c) => c.name) ?? [],
    datasets: [
      {
        data: data?.categoryData.map((c) => c.views) ?? [],
        backgroundColor: CATEGORY_COLORS.slice(0, data?.categoryData.length ?? 0),
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverOffset: 4,
      },
    ],
  }

  const doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    cutout: '68%',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a2744',
        titleColor: '#c9a227',
        bodyColor: '#faf8f3',
        padding: 10,
        cornerRadius: 0,
        callbacks: {
          label: (item) => ` ${(item.raw as number).toLocaleString()} views`,
        },
      },
    },
  }

  const periodSuffix =
    period === '24h' ? 'in the last 24 hours'
    : period === '7d' ? 'in the last 7 days'
    : period === '90d' ? 'in the last 90 days'
    : 'in the last 30 days'

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Analytics
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            Site performance and readership insights.
          </p>
        </div>

        {/* Period dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 bg-[#faf9f7] border border-[#d0cdc5] rounded-lg px-4 py-2 text-[13px] font-medium text-[#1a2744] hover:border-[#1a2744]/40 transition-colors"
          >
            {PERIOD_LABELS[period]}
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-1 w-44 bg-white border border-[#e8e4d9] shadow-lg rounded-lg z-20 overflow-hidden"
              >
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => selectPeriod(p)}
                    className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors ${
                      period === p
                        ? 'bg-[#f5f2eb] text-[#c9a84c] font-semibold'
                        : 'text-[#666] hover:bg-[#f5f2eb] hover:text-[#1a2744]'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-white border border-[#e8e4d9] rounded-lg p-5 animate-pulse"
              >
                <div className="h-2.5 bg-[#f0ede6] w-20 mb-3" />
                <div className="h-8 bg-[#f0ede6] w-24" />
              </div>
            ))}
          </div>
          <div className="bg-white border border-[#e8e4d9] rounded-lg p-6 animate-pulse h-56" />
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 bg-white border border-[#e8e4d9] rounded-lg p-6 animate-pulse h-72" />
            <div className="bg-white border border-[#e8e4d9] rounded-lg p-6 animate-pulse h-72" />
          </div>
        </div>
      )}

      {/* Content */}
      {!loading && data && (
        <motion.div
          key={key}
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-6"
        >
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <motion.div variants={fadeUp}>
              <StatCard
                label={`Views ${periodSuffix}`}
                value={data.summary.viewsInPeriod.toLocaleString()}
                trend={data.summary.viewsChange}
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <StatCard
                label="Total views all time"
                value={data.summary.totalViews.toLocaleString()}
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <StatCard
                label="Published articles"
                value={data.summary.totalPublished}
                accent="emerald"
              />
            </motion.div>
            <motion.div variants={fadeUp}>
              <StatCard
                label={`Published ${periodSuffix}`}
                value={data.summary.newInPeriod}
                accent={data.summary.newInPeriod > 0 ? 'gold' : undefined}
              />
            </motion.div>
          </div>

          {/* Traffic line chart */}
          <motion.div
            variants={fadeUp}
            className="bg-white border border-[#e8e4d9] rounded-lg shadow-sm"
          >
            <div className="px-6 py-4 border-b border-[#e8e4d9] flex items-center justify-between">
              <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                Views over time
              </h2>
              <span className="text-xs text-[var(--fg-faint)]">{PERIOD_LABELS[period]}</span>
            </div>
            <div className="p-6">
              <Line data={lineChartData} options={lineOptions} />
            </div>
          </motion.div>

          {/* Top content (2/3) + Views by section (1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div
              variants={fadeUp}
              className="lg:col-span-2 bg-white border border-[#e8e4d9] rounded-lg shadow-sm overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-[#e8e4d9]">
                <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                  Top content
                </h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {data.topArticles.length > 0 ? (
                  data.topArticles.map((article, i) => (
                    <div
                      key={article.id}
                      className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#faf8f4] transition-colors"
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
                          {article.author.name} in {article.category?.name ?? 'Uncategorised'}
                        </p>
                        <div className="mt-1.5 h-1 bg-[#f0ede6] overflow-hidden rounded-full">
                          <div
                            className="h-full bg-gold/50 transition-all duration-700"
                            style={{ width: `${(article.viewCount / maxTopViews) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span
                        className="shrink-0 text-sm font-bold text-[var(--fg)] tabular-nums"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {article.viewCount.toLocaleString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="py-16 flex flex-col items-center gap-3">
                    <BarChart2 size={32} className="text-[#ccc]" />
                    <p className="text-[15px] font-semibold text-[#1a2744]">No published articles yet</p>
                    <p className="text-[13px] text-[#888]">Articles will appear here once published.</p>
                  </div>
                )}
              </div>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="bg-white border border-[#e8e4d9] rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-[#e8e4d9]">
                <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                  Views by section
                </h2>
              </div>
              <div className="p-6">
                {data.categoryData.length > 0 ? (
                  <>
                    <div className="flex justify-center mb-5">
                      <div style={{ width: 152, height: 152 }}>
                        <Doughnut data={doughnutChartData} options={doughnutOptions} />
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      {data.categoryData.slice(0, 7).map((cat, i) => (
                        <div key={cat.name} className="flex items-center gap-2.5">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: CATEGORY_COLORS[i] }}
                          />
                          <span className="text-xs text-[var(--fg)] flex-1 truncate">
                            {cat.name}
                          </span>
                          <span className="text-xs font-bold text-[var(--fg)] tabular-nums">
                            {cat.views.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-[var(--fg-faint)] text-sm text-center py-8">
                    No section data yet.
                  </p>
                )}
              </div>
            </motion.div>
          </div>

          {/* Author leaderboard */}
          <motion.div
            variants={fadeUp}
            className="bg-white border border-[#e8e4d9] rounded-lg shadow-sm overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-[#e8e4d9]">
              <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                Author leaderboard
              </h2>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {data.authorData.length > 0 ? (
                data.authorData.map((author, i) => (
                  <div
                    key={author.name}
                    className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#faf8f4] transition-colors"
                  >
                    <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--fg)]">{author.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-[var(--fg-faint)]">
                          {author.articles} {author.articles === 1 ? 'article' : 'articles'}
                        </span>
                        <div className="flex-1 h-1 bg-[#f0ede6] overflow-hidden rounded-full max-w-32">
                          <div
                            className="h-full bg-navy/40 transition-all duration-700"
                            style={{ width: `${(author.views / maxAuthorViews) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className="text-sm font-bold text-[var(--fg)] tabular-nums block"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {author.views.toLocaleString()}
                      </span>
                      <span className="text-xs text-[var(--fg-faint)]">
                        avg {Math.round(author.views / author.articles).toLocaleString()} per article
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-16 flex flex-col items-center gap-3">
                  <Users size={32} className="text-[#ccc]" />
                  <p className="text-[15px] font-semibold text-[#1a2744]">No author data yet</p>
                  <p className="text-[13px] text-[#888]">Author stats will appear as articles are published.</p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Recent publishes + Traffic sources */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div
              variants={fadeUp}
              className="bg-white border border-[#e8e4d9] rounded-lg shadow-sm overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-[#e8e4d9]">
                <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                  Recent publishes
                </h2>
              </div>
              <div className="divide-y divide-[#e8e4d9]">
                {data.recentActivity.length > 0 ? (
                  data.recentActivity.map((article) => (
                    <div
                      key={article.id}
                      className="flex items-start gap-3 px-6 py-3.5 hover:bg-[#faf8f4] transition-colors"
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
                          {article.author.name} in {article.category?.name ?? 'Uncategorised'}
                          {article.publishedAt
                            ? `, published ${formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}`
                            : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-[var(--fg-faint)] tabular-nums">
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
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="bg-white border border-[#e8e4d9] rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-[#e8e4d9]">
                <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
                  Traffic sources
                </h2>
              </div>
              <div className="p-6 space-y-4">
                {data.trafficSources.length > 0 && data.trafficSources.some((s) => s.views > 0) ? (
                  data.trafficSources.filter((s) => s.views > 0).map((s) => (
                    <div key={s.source}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-[var(--fg)]">{s.source}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--fg-faint)]">{s.pct}%</span>
                          <span
                            className="text-sm font-bold text-[var(--fg)] tabular-nums"
                            style={{ fontFamily: 'var(--font-serif)' }}
                          >
                            {s.views.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-[#f0ede6] overflow-hidden rounded-full">
                        <div
                          className="h-full bg-gold transition-all duration-700"
                          style={{ width: `${s.pct}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[var(--fg-faint)] text-sm text-center py-6">
                    Source data will appear here as new views come in.
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {!loading && !data && (
        <p className="text-[var(--fg-faint)] text-sm">Could not load analytics data.</p>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  trend,
}: {
  label: string
  value: number | string
  accent?: 'emerald' | 'amber' | 'gold'
  trend?: number | null
}) {
  const accentColor =
    accent === 'emerald' ? '#16a34a'
    : accent === 'amber' ? '#d97706'
    : accent === 'gold' ? '#c9a84c'
    : '#1a2744'

  return (
    <div
      className="bg-white rounded-lg p-5 border border-[#e8e4d9] h-full hover:bg-[#faf8f0] transition-colors duration-150"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <p className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] mb-3">{label}</p>
      <p className="text-[36px] font-semibold text-[#1a2744] leading-none mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      {trend != null && (
        <div
          className={`flex items-center gap-1 mt-2 text-xs font-medium ${
            trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-[#888]'
          }`}
        >
          {trend > 0 ? (
            <TrendingUp size={11} />
          ) : trend < 0 ? (
            <TrendingDown size={11} />
          ) : (
            <Minus size={11} />
          )}
          <span>
            {trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : 'No change'} vs previous period
          </span>
        </div>
      )}
    </div>
  )
}
