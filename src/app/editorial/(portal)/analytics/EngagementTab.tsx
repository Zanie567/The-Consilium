'use client'

import { motion } from 'framer-motion'
import { MessageCircle, Bookmark, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface EngagementData {
  commentRates: {
    id: string; title: string; category: string | null
    views: number; comments: number; commentRate: number
  }[]
  mostDiscussed: {
    id: string; title: string; viewCount: number
    category: string | null; commentCount: number
  }[]
  debateParticipation: {
    title: string; totalVotes: number; forPct: number; againstPct: number; voteRate: number
  }[]
  upvoteTrend: { current: number; previous: number; change: number | null }
  mostSaved: { id: string; title: string; authorName: string | null; count: number }[]
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

export function EngagementTab({ data, loading }: { data: EngagementData | null; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-48" />
        ))}
      </div>
    )
  }

  const { upvoteTrend } = data

  return (
    <motion.div key="engagement" variants={container} initial="hidden" animate="show" className="space-y-6">

      {/* Comment rate + upvote trend stat */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <TabCard title="Comment rate by article" icon={<MessageCircle size={13} />}>
            {data.commentRates.length === 0 ? (
              <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No comment data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-6 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Article</th>
                      <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">Views</th>
                      <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Comments</th>
                      <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Per 100 views</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.commentRates.map(a => (
                      <tr key={a.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                        <td className="px-6 py-3">
                          <p className="font-medium text-[var(--fg)] line-clamp-1">{a.title}</p>
                          {a.category && <p className="text-[10px] text-[var(--fg-faint)]">{a.category}</p>}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--fg-faint)] tabular-nums hidden sm:table-cell">{a.views.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-medium text-[var(--fg)] tabular-nums">{a.comments}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-gold font-bold tabular-nums">{a.commentRate}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabCard>
        </motion.div>

        <motion.div variants={fadeUp}>
          <TabCard title="Comment upvotes" icon={<TrendingUp size={13} />}>
            <div className="p-6">
              <p className="text-4xl font-bold text-[var(--fg)] mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
                {upvoteTrend.current.toLocaleString()}
              </p>
              <p className="text-xs text-[var(--fg-faint)] mb-4">upvotes this period</p>
              {upvoteTrend.change != null && (
                <div className={`flex items-center gap-1 text-xs font-semibold ${
                  upvoteTrend.change > 0 ? 'text-emerald-600' : upvoteTrend.change < 0 ? 'text-red-500' : 'text-[var(--fg-faint)]'
                }`}>
                  {upvoteTrend.change > 0 ? <TrendingUp size={11} /> : upvoteTrend.change < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
                  <span>{upvoteTrend.change > 0 ? `+${upvoteTrend.change}%` : `${upvoteTrend.change}%`} vs prev period</span>
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">Previous period</p>
                <p className="text-lg font-bold text-[var(--fg-muted)]" style={{ fontFamily: 'var(--font-serif)' }}>
                  {upvoteTrend.previous.toLocaleString()}
                </p>
              </div>
            </div>
          </TabCard>
        </motion.div>
      </div>

      {/* Most discussed */}
      <motion.div variants={fadeUp}>
        <TabCard title="Most discussed articles">
          {data.mostDiscussed.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No discussions yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.mostDiscussed.map((a, i) => (
                <div key={a.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors">
                  <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--fg)] line-clamp-1">{a.title}</p>
                    {a.category && <p className="text-xs text-[var(--fg-faint)] mt-0.5">{a.category}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-sm font-bold text-[var(--fg)] tabular-nums">{a.commentCount}</span>
                    <span className="text-xs text-[var(--fg-faint)] ml-1">comments</span>
                    <p className="text-[10px] text-[var(--fg-faint)] mt-0.5">{a.viewCount.toLocaleString()} views</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabCard>
      </motion.div>

      {/* Debate participation */}
      {data.debateParticipation.length > 0 && (
        <motion.div variants={fadeUp}>
          <TabCard title="Debate participation">
            <div className="divide-y divide-[var(--border)]">
              {data.debateParticipation.map(d => (
                <div key={d.title} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <p className="text-sm font-semibold text-[var(--fg)] line-clamp-2 flex-1">{d.title}</p>
                    <span className="text-xs text-[var(--fg-faint)] shrink-0 tabular-nums">{d.totalVotes} votes</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] text-blue-500 font-semibold w-8 text-right tabular-nums">{d.forPct}%</span>
                    <div className="flex-1 h-2 bg-[var(--border)] overflow-hidden flex">
                      <div className="h-full bg-blue-500/60" style={{ width: `${d.forPct}%` }} />
                      <div className="h-full flex-1 bg-gold/50" />
                    </div>
                    <span className="text-[10px] text-gold font-semibold w-8 tabular-nums">{d.againstPct}%</span>
                  </div>
                  <p className="text-[10px] text-[var(--fg-faint)]">
                    {d.voteRate}% of site views in this period
                  </p>
                </div>
              ))}
            </div>
          </TabCard>
        </motion.div>
      )}

      {/* Most saved */}
      <motion.div variants={fadeUp}>
        <TabCard title="Most saved articles" icon={<Bookmark size={13} />}>
          {data.mostSaved.length === 0 ? (
            <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">No bookmark data yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {data.mostSaved.map((a, i) => (
                <div key={a.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[var(--bg-subtle)] transition-colors">
                  <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--fg)] line-clamp-1">{a.title}</p>
                    {a.authorName && <p className="text-xs text-[var(--fg-faint)] mt-0.5">{a.authorName}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-bold text-[var(--fg)] tabular-nums">
                    {a.count}
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
