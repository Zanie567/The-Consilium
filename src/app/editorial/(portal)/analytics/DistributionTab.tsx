'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Signal, Clock, Link2, BarChart3 } from 'lucide-react'
import { CampaignLinkBuilder } from './CampaignLinkBuilder'
import { SearchConsolePanel } from './SearchConsolePanel'
import type { Period } from './AnalyticsDashboard'

export interface DistributionData {
  trafficSources: { source: string; views: number; pct: number }[]
  topReferrers: { source: string; views: number }[]
  taggedLandings: number
  campaigns: { campaign: string; source: string; medium: string; content: string; landings: number }[]
  articleSourcePerformance: {
    id: string; title: string; slug: string; articleId: string;
    views: number; knownLandings: number; search: number; social: number;
    email: number; internal: number; unknown: number; other: number;
  }[]
  recentActivity: {
    id: string; title: string; slug: string; publishedAt: string | null; viewCount: number
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

export function DistributionTab({ data, loading, period }: { data: DistributionData | null; loading: boolean; period: Period }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
      </div>
    )
  }

  const hasRealSources = data.trafficSources.some(s => s.views > 0 && s.source !== 'Direct / unknown' && s.source !== 'Internal')

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
            {!hasRealSources && data.trafficSources.some(s => s.views > 0) && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
                  Referral information is missing for these views; they may be direct visits or come from apps and browsers that hide referral details.
                </p>
              </div>
            )}
            {data.topReferrers.length > 0 && (
              <div className="pt-4 border-t border-[var(--border)] space-y-3">
                <h3 className="text-xs uppercase tracking-widest font-bold text-[var(--fg)]">
                  Top referring websites
                </h3>
                <div className="space-y-2">
                  {data.topReferrers.map(referrer => (
                    <div key={referrer.source} className="flex justify-between gap-4 text-sm">
                      <span className="text-[var(--fg-muted)] break-all">{referrer.source}</span>
                      <span className="tabular-nums font-semibold text-[var(--fg)]">
                        {referrer.views.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabCard>
      </motion.div>

      <p className="text-xs text-[var(--fg-faint)]">Traffic sources cover the selected period and are inferred from available referrers. Direct / unknown includes visits without a usable referrer, such as some email or private-app links. Internal traffic represents views referred from The Consilium itself; it is not new acquisition. Referrer counts are page views, not individual people.</p>

      {/* Clearly labelled acquisition reports, not a unique-visitor estimate */}
      <motion.div variants={fadeUp}>
        <TabCard title="Campaign landing views" icon={<BarChart3 size={13} />}>
          <div className="p-6 space-y-4">
            <p className="text-xs text-[var(--fg-faint)]">
              Tagged first-page arrivals during the selected period: {data.taggedLandings.toLocaleString()}.
              Only links using complete UTM source, medium and campaign labels appear.
              Repeat navigation is excluded; historical untagged traffic cannot be assigned retroactively.
            </p>
            {data.campaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border)] text-[var(--fg-faint)] text-xs uppercase tracking-wide">
                    <th className="text-left py-3 pr-3">Campaign</th>
                    <th className="text-left py-3 pr-3">Source / medium</th>
                    <th className="text-left py-3 pr-3">Creative</th>
                    <th className="text-right py-3">Landings</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.campaigns.map((item, index) => (
                      <tr key={`${item.campaign}-${item.source}-${item.medium}-${item.content}-${index}`}>
                        <td className="py-3 pr-3 font-semibold text-[var(--fg)] break-all">{item.campaign}</td>
                        <td className="py-3 pr-3 text-[var(--fg-muted)]">{item.source} / {item.medium}</td>
                        <td className="py-3 pr-3 text-[var(--fg-muted)]">{item.content || '—'}</td>
                        <td className="py-3 text-right font-semibold text-[var(--fg)] tabular-nums">{item.landings.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--fg-faint)]">No tagged campaign landings yet. Use the builder below for the next published promotion.</p>
            )}
          </div>
        </TabCard>
      </motion.div>

      <motion.div variants={fadeUp}>
        <TabCard title="Build a campaign link" icon={<Link2 size={13} />}>
          <CampaignLinkBuilder articles={data.recentActivity.map(article => ({
            id: article.id, title: article.title, slug: article.slug,
          }))} />
        </TabCard>
      </motion.div>

      <motion.div variants={fadeUp}>
        <TabCard title="Article performance by traffic source" icon={<BarChart3 size={13} />}>
          <div className="p-6 space-y-3">
            <p className="text-xs text-[var(--fg-faint)]">
              Recorded article page views by source during the selected period.
              Historical referrers are approximate. Known landings count only events explicitly
              marked as a new arrival after the Phase 1 tracking upgrade.
            </p>
            {data.articleSourcePerformance.length === 0 ? (
              <p className="text-sm text-[var(--fg-faint)]">No article views for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--fg-faint)]">
                    <th className="text-left py-3 pr-3">Article</th>
                    <th className="text-right px-2 py-3">Views</th>
                    <th className="text-right px-2 py-3">Known landings</th>
                    <th className="text-right px-2 py-3">Search</th>
                    <th className="text-right px-2 py-3">Social</th>
                    <th className="text-right py-3">Unknown</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.articleSourcePerformance.map(article => (
                      <tr key={article.id}>
                        <td className="py-3 pr-3 font-medium text-[var(--fg)] max-w-[260px]">{article.title}</td>
                        <td className="text-right px-2 py-3 tabular-nums">{article.views}</td>
                        <td className="text-right px-2 py-3 tabular-nums">{article.knownLandings}</td>
                        <td className="text-right px-2 py-3 tabular-nums">{article.search}</td>
                        <td className="text-right px-2 py-3 tabular-nums">{article.social}</td>
                        <td className="text-right py-3 tabular-nums">{article.unknown}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabCard>
      </motion.div>

      <motion.div variants={fadeUp}><SearchConsolePanel period={period} /></motion.div>

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
                      {article.title || <span className="italic text-[var(--fg-faint)]">(Untitled)</span>}
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
