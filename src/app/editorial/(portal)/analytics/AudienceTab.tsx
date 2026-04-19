'use client'

import { motion } from 'framer-motion'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Tooltip,
  type ChartOptions,
} from 'chart.js'
import { TrendingUp, TrendingDown, Minus, Users, Bookmark } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface AudienceData {
  returnVisitorRate: {
    rate: number; newCount: number; returningCount: number; trend: number
  }
  subscriberGrowth: { week: string; count: number }[]
  subscriberRatio: number | null
  totalSubscribers: number
  uniqueReaders: number
  mostBookmarked: {
    id: string; title: string; authorName: string | null
    category: string | null; count: number
  }[]
}

const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38 } } }
const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }

function TabCard({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center gap-2">
        {icon && <span className="text-[var(--fg-faint)]">{icon}</span>}
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export function AudienceTab({ data, loading }: { data: AudienceData | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
        ))}
      </div>
    )
  }

  const barData = {
    labels: data.subscriberGrowth.map(w => w.week),
    datasets: [{
      label: 'New subscribers',
      data: data.subscriberGrowth.map(w => w.count),
      backgroundColor: 'rgba(201,168,76,0.6)',
      borderColor: '#c9a84c',
      borderWidth: 1,
      borderRadius: 2,
    }],
  }
  const barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 3,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a2744', titleColor: '#c9a227', bodyColor: '#faf8f3',
        padding: 10, cornerRadius: 0,
        callbacks: { label: item => ` ${(item.raw as number)} new subscribers` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: 'rgba(26,39,68,0.45)', font: { size: 10 }, maxRotation: 0 },
        border: { display: false },
      },
      y: {
        grid: { color: 'rgba(26,39,68,0.06)' },
        ticks: { color: 'rgba(26,39,68,0.45)', font: { size: 10 }, maxTicksLimit: 4 },
        border: { display: false },
        beginAtZero: true,
      },
    },
  }

  const { returnVisitorRate: rv } = data
  const total = rv.newCount + rv.returningCount || 1
  const newPct = Math.round((rv.newCount / total) * 100)
  const returnPct = 100 - newPct

  return (
    <motion.div key="audience" variants={container} initial="hidden" animate="show" className="space-y-6">

      {/* Return visitor + new vs returning */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={fadeUp}>
          <TabCard title="Return visitor rate" icon={<Users size={13} />}>
            <div className="p-6">
              <div className="flex items-end gap-3 mb-3">
                <span className="text-4xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                  {rv.rate}%
                </span>
                <span className={`flex items-center gap-1 text-xs font-semibold mb-1 ${
                  rv.trend > 0 ? 'text-emerald-600' : rv.trend < 0 ? 'text-red-500' : 'text-[var(--fg-faint)]'
                }`}>
                  {rv.trend > 0 ? <TrendingUp size={11} /> : rv.trend < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
                  {rv.trend > 0 ? `+${rv.trend}pp` : rv.trend < 0 ? `${rv.trend}pp` : 'No change'} vs prev period
                </span>
              </div>
              <p className="text-xs text-[var(--fg-faint)] mb-4">
                {rv.returningCount.toLocaleString()} of {(rv.newCount + rv.returningCount).toLocaleString()} unique sessions were returning visitors.
              </p>

              {/* New vs returning bar */}
              <div className="space-y-2">
                <div className="h-3 rounded-full overflow-hidden flex bg-[var(--bg-subtle)]">
                  <div className="h-full bg-gold/60" style={{ width: `${newPct}%` }} />
                  <div className="h-full bg-navy/40 flex-1" />
                </div>
                <div className="flex justify-between text-[10px] text-[var(--fg-faint)]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gold/60 inline-block" />
                    New — {newPct}% ({rv.newCount.toLocaleString()})
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-navy/40 inline-block" />
                    Returning — {returnPct}% ({rv.returningCount.toLocaleString()})
                  </span>
                </div>
              </div>
            </div>
          </TabCard>
        </motion.div>

        <motion.div variants={fadeUp}>
          <TabCard title="Subscriber snapshot" icon={<Users size={13} />}>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[var(--fg-faint)] uppercase tracking-widest">Total subscribers</span>
                <span className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                  {data.totalSubscribers.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[var(--fg-faint)] uppercase tracking-widest">Unique readers (period)</span>
                <span className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                  {data.uniqueReaders.toLocaleString()}
                </span>
              </div>
              {data.subscriberRatio !== null && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-[var(--fg-faint)] uppercase tracking-widest">Subscriber / reader ratio</span>
                    <span className="text-lg font-bold text-gold tabular-nums">{data.subscriberRatio}×</span>
                  </div>
                  <p className="text-[10px] text-[var(--fg-faint)]">
                    For every {data.subscriberRatio} readers this period, 1 is a subscriber.
                  </p>
                </div>
              )}
            </div>
          </TabCard>
        </motion.div>
      </div>

      {/* Subscriber growth chart */}
      <motion.div variants={fadeUp}>
        <TabCard title="Subscriber growth — last 12 weeks">
          <div className="p-6">
            {data.subscriberGrowth.some(w => w.count > 0) ? (
              <Bar data={barData} options={barOptions} />
            ) : (
              <p className="text-center text-[var(--fg-faint)] text-sm py-8">No new subscribers in the last 12 weeks.</p>
            )}
          </div>
        </TabCard>
      </motion.div>

      {/* Most bookmarked */}
      <motion.div variants={fadeUp}>
        <TabCard title="Most bookmarked articles" icon={<Bookmark size={13} />}>
          {data.mostBookmarked.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No bookmark data yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.mostBookmarked.map((article, i) => (
                <div key={article.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors">
                  <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--fg)] line-clamp-1">{article.title}</p>
                    <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                      {article.authorName ?? 'Unknown'}
                      {article.category && ` · ${article.category}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-[var(--fg)] tabular-nums">
                    {article.count.toLocaleString()}
                    <span className="text-xs font-normal text-[var(--fg-faint)] ml-1">saves</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabCard>
      </motion.div>

    </motion.div>
  )
}
