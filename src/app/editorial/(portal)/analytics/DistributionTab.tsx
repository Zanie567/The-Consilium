'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Signal, Clock } from 'lucide-react'

export interface DistributionData {
  trafficSources: { source: string; views: number; pct: number }[]
  recentActivity: {
    id: string; title: string; publishedAt: string | null; viewCount: number
    author: { name: string | null }; category: { name: string } | null
  }[]
}

const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38 } } }
const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }

function TabCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
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

export function DistributionTab({ data, loading }: { data: DistributionData | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
      </div>
    )
  }

  const hasRealSources = data.trafficSources.some(s => s.views > 0 && s.source !== 'Direct')

  return (
    <motion.div key="distribution" variants={container} initial="hidden" animate="show" className="space-y-6">

      {/* Traffic sources */}
      <motion.div variants={fadeUp}>
        <TabCard title="Traffic sources" icon={<Signal size={13} />}>
          <div className="p-6 space-y-5">
            {data.trafficSources.filter(s => s.views > 0).length > 0
              ? data.trafficSources.filter(s => s.views > 0).map(s => (
                  <div key={s.source}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-[var(--fg)]">{s.source}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--fg-faint)]">{s.pct}%</span>
                        <span className="text-sm font-bold text-[var(--fg)] tabular-nums" style={{ fontFamily: 'var(--font-serif)' }}>
                          {s.views.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-subtle)] overflow-hidden">
                      <div className="h-full bg-gold transition-all duration-700" style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))
              : (
                <p className="text-[var(--fg-faint)] text-sm text-center py-4">
                  Source data will appear here as new views come in.
                </p>
              )
            }
            {!hasRealSources && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
                  As your publication grows, this tab will show referral sources, search visibility, and social traffic breakdowns.
                  Currently all traffic is direct. Readers are coming straight to your content.
                </p>
              </div>
            )}
          </div>
        </TabCard>
      </motion.div>

      {/* Recent publishes */}
      <motion.div variants={fadeUp}>
        <TabCard title="Recent publishes" icon={<Clock size={13} />}>
          {data.recentActivity.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No recent activity.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.recentActivity.map(article => (
                <div key={article.id} className="flex items-start gap-3 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors">
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
                        ? `, ${formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}`
                        : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--fg-faint)] tabular-nums">
                    {article.viewCount.toLocaleString()} views
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
