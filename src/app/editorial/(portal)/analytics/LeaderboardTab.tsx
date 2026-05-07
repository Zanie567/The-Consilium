'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Crown, ChevronUp, ChevronDown as ChevDown } from 'lucide-react'
import type { Period } from './AnalyticsDashboard'

interface WriterRow {
  id: string
  name: string
  rank: number
  articlesCount: number
  totalReadingMinutes: number
  avgCompletionRate: number
  avgViewsPerArticle: number
  commentsGenerated: number
}

interface LeaderboardData {
  writers: WriterRow[]
}

type SortCol = keyof Omit<WriterRow, 'id' | 'name'>
type SortDir = 'asc' | 'desc'

const PERIOD_LABELS: Record<Period, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
}

const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

function SortBtn({ col, label, sortCol, sortDir, onSort }: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortDir: SortDir
  onSort: (col: SortCol) => void
}) {
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-[var(--fg)] ${
        sortCol === col ? 'text-gold' : 'text-[var(--fg-faint)]'
      }`}
    >
      {label}
      {sortCol === col
        ? (sortDir === 'desc' ? <ChevDown size={10} /> : <ChevronUp size={10} />)
        : <ChevDown size={10} className="opacity-30" />}
    </button>
  )
}

export function LeaderboardTab({ data, loading, period }: {
  data: LeaderboardData | null
  loading: boolean
  period: Period
}) {
  const [sortCol, setSortCol] = useState<SortCol>('totalReadingMinutes')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 animate-pulse h-12" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 animate-pulse h-14" />
        ))}
      </div>
    )
  }

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  const sorted = [...data.writers].sort((a, b) => {
    const va = a[sortCol] as number
    const vb = b[sortCol] as number
    return sortDir === 'desc' ? vb - va : va - vb
  })

  return (
    <motion.div key="leaderboard" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }} className="space-y-4">

      {/* Note */}
      <motion.div
        variants={fadeUp}
        className="bg-navy/5 dark:bg-white/5 border border-[var(--border)] px-6 py-4"
      >
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          <strong className="text-[var(--fg)]">Rankings are based on reader engagement, not just view counts.</strong>{' '}
          A writer whose articles are read in full scores higher than one whose articles are opened but not read.
          Period: <span className="text-gold">{PERIOD_LABELS[period]}</span>.
        </p>
      </motion.div>

      {sorted.length === 0 ? (
        <motion.div variants={fadeUp} className="bg-[var(--bg-elevated)] border border-[var(--border)] px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
          No writers have published articles in this period.
        </motion.div>
      ) : (
        <motion.div variants={fadeUp} className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-3 text-left w-10">
                    <SortBtn col="rank" label="#" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">Writer</th>
                  <th className="px-4 py-3 text-right">
                    <SortBtn col="articlesCount" label="Articles" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortBtn col="totalReadingMinutes" label="Reading Mins" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortBtn col="avgCompletionRate" label="Avg Read %" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortBtn col="avgViewsPerArticle" label="Avg Views" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortBtn col="commentsGenerated" label="Comments" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sorted.map((writer) => (
                  <tr key={writer.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="px-4 py-3 text-center">
                      {writer.rank === 1 ? (
                        <Crown size={14} className="text-gold mx-auto" />
                      ) : (
                        <span className="text-xs font-bold text-[var(--fg-faint)] tabular-nums">{writer.rank}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--fg)]">{writer.name}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">{writer.articlesCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-gold">
                      {writer.totalReadingMinutes.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">{writer.avgCompletionRate}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">{writer.avgViewsPerArticle.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">{writer.commentsGenerated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
