'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Crown, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react'

type LeaderboardPeriod = 'week' | 'month' | 'alltime'

const PERIOD_OPTIONS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week',    label: 'This Week' },
  { id: 'month',   label: 'This Month' },
  { id: 'alltime', label: 'All Time' },
]

interface WriterRow {
  id: string
  name: string
  rank: number
  rankChange: number | null
  articlesCount: number
  totalReadingMinutes: number
  avgCompletionRate: number
  avgViewsPerArticle: number
  commentsGenerated: number
}

type SortCol = keyof Omit<WriterRow, 'id' | 'name' | 'rankChange'>
type SortDir = 'asc' | 'desc'

const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

export function LeaderboardClient({ currentUserId }: { currentUserId: string }) {
  const [period, setPeriod]       = useState<LeaderboardPeriod>('month')
  const [writers, setWriters]     = useState<WriterRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [sortCol, setSortCol]     = useState<SortCol>('totalReadingMinutes')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')

  const fetchData = useCallback(async (p: LeaderboardPeriod) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/editorial/leaderboard?period=${p}`)
      if (res.ok) {
        const json = await res.json()
        setWriters(json.writers ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(period) }, [period, fetchData])

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  const sorted = [...writers].sort((a, b) => {
    const va = a[sortCol] as number
    const vb = b[sortCol] as number
    return sortDir === 'desc' ? vb - va : va - vb
  })

  const currentWriter = writers.find(w => w.id === currentUserId)

  const SortBtn = ({ col, label, align = 'right' }: { col: SortCol; label: string; align?: string }) => (
    <button
      onClick={() => handleSort(col)}
      className={`flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-[var(--fg)] ${
        sortCol === col ? 'text-gold' : 'text-[var(--fg-faint)]'
      } ${align === 'right' ? 'ml-auto' : ''}`}
    >
      {label}
      {sortCol === col
        ? (sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />)
        : <ChevronDown size={10} className="opacity-30" />}
    </button>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      {/* Header */}
      <div className="pl-10 md:pl-0 mb-6">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Writer Leaderboard
        </h1>
        <p className="text-[var(--fg-muted)] text-sm max-w-xl">
          Compete with your fellow writers. Rankings update daily and reflect how deeply your articles are being read, not just clicked.
        </p>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => setPeriod(opt.id)}
            className={[
              'px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors border',
              period === opt.id
                ? 'bg-navy text-gold border-gold/30'
                : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:text-[var(--fg)]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Current user personal stats */}
      {!loading && currentWriter && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gold/5 border border-gold/20 p-5"
        >
          <p className="text-[10px] text-gold uppercase tracking-widest font-bold mb-3">Your Stats</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">Your Rank</p>
              <div className="flex items-end gap-1.5">
                <span className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                  #{currentWriter.rank}
                </span>
                {currentWriter.rankChange !== null && currentWriter.rankChange !== 0 && (
                  <span className={`flex items-center gap-0.5 text-xs font-semibold mb-0.5 ${
                    currentWriter.rankChange > 0 ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {currentWriter.rankChange > 0
                      ? <><TrendingUp size={10} /> +{currentWriter.rankChange} from last period</>
                      : <><TrendingDown size={10} /> {currentWriter.rankChange} from last period</>}
                  </span>
                )}
                {currentWriter.rankChange === 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-[var(--fg-faint)] mb-0.5">
                    <Minus size={10} /> Same as last period
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">Reading Mins</p>
              <span className="text-2xl font-bold text-gold" style={{ fontFamily: 'var(--font-serif)' }}>
                {currentWriter.totalReadingMinutes.toFixed(1)}
              </span>
            </div>
            <div>
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">Avg Read %</p>
              <span className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                {currentWriter.avgCompletionRate}%
              </span>
            </div>
            <div>
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">Articles</p>
              <span className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
                {currentWriter.articlesCount}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Leaderboard table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 animate-pulse h-14" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
          No writers have published articles in this period.
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-3 text-left w-10">
                    <SortBtn col="rank" label="#" align="left" />
                  </th>
                  <th className="px-4 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                    Writer
                  </th>
                  <th className="px-4 py-3 text-right"><SortBtn col="articlesCount" label="Articles" /></th>
                  <th className="px-4 py-3 text-right"><SortBtn col="totalReadingMinutes" label="Reading Mins" /></th>
                  <th className="px-4 py-3 text-right"><SortBtn col="avgCompletionRate" label="Avg Read %" /></th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">
                    <SortBtn col="avgViewsPerArticle" label="Avg Views" />
                  </th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">
                    <SortBtn col="commentsGenerated" label="Comments" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sorted.map(writer => {
                  const isCurrentUser = writer.id === currentUserId
                  return (
                    <tr
                      key={writer.id}
                      className="transition-colors hover:bg-[var(--bg-subtle)]"
                      style={isCurrentUser ? { backgroundColor: 'rgba(201,168,76,0.07)' } : undefined}
                    >
                      <td className="px-4 py-3 text-center">
                        {writer.rank === 1 ? (
                          <Crown size={14} className="text-gold mx-auto" />
                        ) : (
                          <span className="text-xs font-bold text-[var(--fg-faint)] tabular-nums">{writer.rank}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${isCurrentUser ? 'text-gold' : 'text-[var(--fg)]'}`}>
                          {writer.name}
                          {isCurrentUser && <span className="ml-1.5 text-[10px] text-gold/70">(you)</span>}
                        </span>
                        {/* Rank change badge */}
                        {writer.rankChange !== null && writer.rankChange !== 0 && (
                          <span className={`ml-2 text-[10px] ${writer.rankChange > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {writer.rankChange > 0 ? `↑${writer.rankChange}` : `↓${Math.abs(writer.rankChange)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">{writer.articlesCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-gold">
                        {writer.totalReadingMinutes.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">{writer.avgCompletionRate}%</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)] hidden sm:table-cell">
                        {writer.avgViewsPerArticle.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)] hidden sm:table-cell">
                        {writer.commentsGenerated}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  )
}
