'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, Zap, Clock, BookOpen } from 'lucide-react'

export interface ContentData {
  topArticles: {
    id: string; title: string; viewCount: number
    publishedAt: string | null
    author: { name: string | null }
    category: { name: string } | null
  }[]
  velocityData: {
    id: string; title: string; publishedAt: string | null
    first48hViews: number; authorName: string | null
  }[]
  underperforming: {
    id: string; title: string; publishedAt: string | null
    author: { name: string | null }
  }[]
  bestPublishSlots: { label: string; avgViews: number; count: number }[]
  categoryPerformance: {
    name: string; totalViews: number; articles: number
    avgViews: number; avgCompletion: number | null
  }[]
  completionRates: {
    id: string; title: string; authorName: string | null
    avgProgress: number; readerCount: number
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

export function ContentTab({ data, loading }: { data: ContentData | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
        ))}
      </div>
    )
  }

  const maxTopViews = Math.max(...data.topArticles.map(a => a.viewCount), 1)

  return (
    <motion.div key="content" variants={container} initial="hidden" animate="show" className="space-y-6">

      {/* Top articles */}
      <motion.div variants={fadeUp}>
        <TabCard title="Top articles by views" icon={<BookOpen size={13} />}>
          {data.topArticles.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No published articles yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.topArticles.map((article, i) => (
                <div key={article.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors">
                  <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <Link href={`/editorial/articles/${article.id}/edit`} className="text-sm font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1">
                      {article.title}
                    </Link>
                    <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                      {article.author.name} · {article.category?.name ?? 'Uncategorised'}
                    </p>
                    <div className="mt-1.5 h-1 bg-[var(--bg-subtle)] overflow-hidden">
                      <div className="h-full bg-gold/50 transition-all duration-700" style={{ width: `${(article.viewCount / maxTopViews) * 100}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-[var(--fg)] tabular-nums" style={{ fontFamily: 'var(--font-serif)' }}>
                    {article.viewCount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabCard>
      </motion.div>

      {/* Article velocity + best publish time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={fadeUp}>
          <TabCard title="First 48h velocity" icon={<Zap size={13} />}>
            {data.velocityData.length === 0 ? (
              <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No articles published in this period.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {data.velocityData.map((article, i) => (
                  <div key={article.id} className="flex items-center gap-3 px-6 py-3 hover:bg-[var(--bg-subtle)] transition-colors">
                    <span className="text-[var(--fg-faint)] text-xs font-bold w-4 shrink-0 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <Link href={`/editorial/articles/${article.id}/edit`} className="text-sm font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1">
                        {article.title}
                      </Link>
                      {article.authorName && (
                        <p className="text-[10px] text-[var(--fg-faint)] mt-0.5">{article.authorName}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs font-bold text-[var(--fg)] tabular-nums">
                      {article.first48hViews} <span className="font-normal text-[var(--fg-faint)]">views/48h</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabCard>
        </motion.div>

        <motion.div variants={fadeUp}>
          <TabCard title="Best publish times" icon={<Clock size={13} />}>
            {data.bestPublishSlots.length === 0 ? (
              <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">Not enough data yet. Publish more articles to see patterns.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {data.bestPublishSlots.map((slot, i) => (
                  <div key={slot.label} className="flex items-center gap-3 px-6 py-3.5">
                    <span className="text-[var(--fg-faint)] text-xs font-bold w-4 shrink-0">{i + 1}</span>
                    <span className="flex-1 text-sm text-[var(--fg)]">{slot.label}</span>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-bold text-gold tabular-nums">{slot.avgViews}</span>
                      <span className="text-[10px] text-[var(--fg-faint)] ml-1">avg views</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="px-6 py-3 text-[10px] text-[var(--fg-faint)] border-t border-[var(--border)]">
              Based on average views in the first 24 hours after publishing.
            </p>
          </TabCard>
        </motion.div>
      </div>

      {/* Underperforming articles */}
      {data.underperforming.length > 0 && (
        <motion.div variants={fadeUp}>
          <div className="bg-amber-500/5 border border-amber-500/20 overflow-hidden">
            <div className="px-6 py-4 border-b border-amber-500/20 flex items-center gap-2">
              <AlertTriangle size={13} className="text-amber-500/70" />
              <h2 className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                Underperforming articles
              </h2>
              <span className="ml-auto text-[10px] text-amber-500/60">Published &gt;7 days ago · 0 views</span>
            </div>
            <div className="divide-y divide-amber-500/10">
              {data.underperforming.map(article => (
                <div key={article.id} className="flex items-center gap-3 px-6 py-3 hover:bg-amber-500/5 transition-colors">
                  <div className="flex-1 min-w-0">
                    <Link href={`/editorial/articles/${article.id}/edit`} className="text-sm font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1">
                      {article.title}
                    </Link>
                    <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                      {article.author?.name ?? 'Unknown'}
                      {article.publishedAt && ` · Published ${formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-amber-500 font-bold px-2 py-0.5 bg-amber-500/10">0 views</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Category performance */}
      <motion.div variants={fadeUp}>
        <TabCard title="Category performance">
          {data.categoryPerformance.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No category data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-6 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Articles</th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Total Views</th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Avg Views</th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Avg Read %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.categoryPerformance.map(cat => (
                    <tr key={cat.name} className="hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-6 py-3 font-medium text-[var(--fg)]">{cat.name}</td>
                      <td className="px-4 py-3 text-right text-[var(--fg-faint)] tabular-nums">{cat.articles}</td>
                      <td className="px-4 py-3 text-right font-bold text-[var(--fg)] tabular-nums">{cat.totalViews.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-[var(--fg)] tabular-nums">{cat.avgViews.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {cat.avgCompletion !== null
                          ? <span className="text-[var(--fg)] font-medium">{cat.avgCompletion}%</span>
                          : <span className="text-[var(--fg-faint)]">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabCard>
      </motion.div>

      {/* Reading completion rates */}
      <motion.div variants={fadeUp}>
        <TabCard title="Reading completion rates">
          {data.completionRates.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No reading progress data yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.completionRates.map((article, i) => (
                <div key={article.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors">
                  <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--fg)] line-clamp-1">{article.title}</p>
                    <p className="text-[10px] text-[var(--fg-faint)] mt-0.5">
                      {article.authorName ?? 'Unknown'} · {article.readerCount} reader{article.readerCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-[var(--bg-subtle)] overflow-hidden">
                        <div
                          className="h-full bg-gold/60 transition-all duration-700"
                          style={{ width: `${article.avgProgress}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-[var(--fg)] tabular-nums w-10 text-right">
                        {article.avgProgress}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabCard>
      </motion.div>

    </motion.div>
  )
}
