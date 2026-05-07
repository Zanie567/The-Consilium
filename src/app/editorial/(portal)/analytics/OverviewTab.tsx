'use client'

import { motion } from 'framer-motion'
import { Line } from 'react-chartjs-2'
import { COLORS } from '@/lib/constants'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip,
  type ChartOptions,
} from 'chart.js'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { Period } from './AnalyticsDashboard'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

interface OverviewData {
  summary: {
    viewsInPeriod: number
    viewsChange: number | null
    totalViews: number
    totalPublished: number
    subscriberCount: number
    subscribersInPeriod: number
    subscriberChange: number | null
  }
  trafficData: { label: string; views: number; published: number }[]
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
}
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}

function StatCard({
  label, value, trend,
}: {
  label: string
  value: number | string
  trend?: number | null
}) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)] h-full">
      <p className="text-[var(--fg-faint)] text-xs uppercase tracking-widest mb-2">{label}</p>
      <p className="text-3xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {trend != null && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
          trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-[var(--fg-faint)]'
        }`}>
          {trend > 0 ? <TrendingUp size={11} /> : trend < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
          <span>{trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : 'No change'} vs previous period</span>
        </div>
      )}
    </div>
  )
}

const PERIOD_LABELS: Record<Period, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
}

export function OverviewTab({ data, loading, period }: { data: OverviewData | null; loading: boolean; period: Period }) {
  const lineData = {
    labels: data?.trafficData.map(d => d.label) ?? [],
    datasets: [{
      label: 'Views',
      data: data?.trafficData.map(d => d.views) ?? [],
      borderColor: '#c9a227',
      backgroundColor: 'rgba(201,162,39,0.08)',
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: '#c9a227',
      tension: 0.4,
      fill: true,
    }],
  }

  const lineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: period === '90d' ? 4 : 3.2,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: COLORS.NAVY, titleColor: COLORS.GOLD, bodyColor: COLORS.CREAM,
        padding: 12, cornerRadius: 0,
        callbacks: { label: item => ` ${(item.raw as number).toLocaleString()} views` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: 'rgba(26,39,68,0.45)', font: { size: 10 }, maxRotation: 0,
          maxTicksLimit: period === '24h' ? 12 : period === '90d' ? 12 : 10,
        },
        border: { display: false },
      },
      y: {
        grid: { color: 'rgba(26,39,68,0.06)' },
        ticks: { color: 'rgba(26,39,68,0.45)', font: { size: 10 }, maxTicksLimit: 5 },
        border: { display: false },
        beginAtZero: true,
      },
    },
  }

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 animate-pulse">
              <div className="h-2.5 bg-[var(--bg-subtle)] w-20 mb-3" />
              <div className="h-8 bg-[var(--bg-subtle)] w-24" />
            </div>
          ))}
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-64" />
      </div>
    )
  }

  const { summary } = data

  return (
    <motion.div key="overview" variants={container} initial="hidden" animate="show" className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <motion.div variants={fadeUp}>
          <StatCard label={`Views: ${PERIOD_LABELS[period]}`} value={summary.viewsInPeriod} trend={summary.viewsChange} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Total views all time" value={summary.totalViews} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Published articles" value={summary.totalPublished} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard label="Subscribers" value={summary.subscriberCount} trend={summary.subscriberChange} />
        </motion.div>
      </div>

      {/* Comparison row */}
      <motion.div
        variants={fadeUp}
        className="grid grid-cols-2 gap-4"
      >
        {[
          { label: 'Views this period', curr: summary.viewsInPeriod, change: summary.viewsChange },
          { label: 'New subscribers', curr: summary.subscribersInPeriod, change: summary.subscriberChange },
        ].map(({ label, curr, change }) => (
          <div key={label} className="bg-[var(--bg-elevated)] border border-[var(--border)] px-5 py-3 flex items-center justify-between">
            <span className="text-xs text-[var(--fg-faint)] uppercase tracking-widest">{label}</span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                {curr.toLocaleString()}
              </span>
              {change != null && (
                <span className={`flex items-center gap-0.5 text-xs font-semibold ${
                  change > 0 ? 'text-emerald-600' : change < 0 ? 'text-red-500' : 'text-[var(--fg-faint)]'
                }`}>
                  {change > 0 ? <TrendingUp size={10} /> : change < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
                  {change > 0 ? `+${change}%` : change < 0 ? `${change}%` : '0%'}
                </span>
              )}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Views chart */}
      <motion.div
        variants={fadeUp}
        className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]"
      >
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">Views over time</h2>
          <span className="text-xs text-[var(--fg-faint)]">{PERIOD_LABELS[period]}</span>
        </div>
        <div className="p-6">
          <Line data={lineData} options={lineOptions} />
        </div>
      </motion.div>
    </motion.div>
  )
}
