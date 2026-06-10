'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import { BookOpenCheck, ChevronDown, ChevronUp, Users } from 'lucide-react'
import { COLORS } from '@/lib/constants'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface ArticleRow {
  id: string
  title: string
  slug: string
  publishedAt: string | null
  viewCount: number
  readerCount: number
  hasEnoughData: boolean
  completionRate: number | null
  medianProgress: number | null
}

interface RetentionPoint {
  threshold: number
  readers: number
  share: number
}

interface ArticleDetail {
  article: {
    id: string
    title: string
    slug: string
    publishedAt: string | null
    viewCount: number
  }
  stats: {
    readerCount: number
    hasEnoughData: boolean
    completionRate: number | null
    medianProgress: number | null
    retention: RetentionPoint[] | null
    steepestDrop: { from: number; to: number; readersLost: number; lostShare: number } | null
  }
}

type SortKey = 'publishedAt' | 'readerCount' | 'completionRate' | 'medianProgress'

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

function dropLabel(drop: { from: number; to: number }): string {
  if (drop.from === 0) return `between the start and the ${drop.to}% mark`
  return `between ${drop.from}% and ${drop.to}% of the article`
}

export function ReadersDashboard({
  currentUserId,
  isAdmin,
  authors,
}: {
  currentUserId: string
  isAdmin: boolean
  authors: { id: string; name: string }[]
}) {
  const [authorId, setAuthorId] = useState(currentUserId)
  const [articles, setArticles] = useState<ArticleRow[] | null>(null)
  const [listError, setListError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ArticleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('publishedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const fetchList = useCallback(async (forAuthor: string) => {
    setArticles(null)
    setListError(false)
    setSelectedId(null)
    setDetail(null)
    try {
      const qs = forAuthor !== currentUserId ? `?authorId=${encodeURIComponent(forAuthor)}` : ''
      const res = await fetch(`/api/editorial/read-through${qs}`)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setArticles(json.articles)
    } catch {
      setListError(true)
      setArticles([])
    }
  }, [currentUserId])

  useEffect(() => {
    fetchList(authorId)
  }, [authorId, fetchList])

  const selectArticle = useCallback(async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/editorial/read-through/${id}`)
      if (res.ok) setDetail(await res.json())
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    if (!articles) return []
    const value = (a: ArticleRow): number => {
      switch (sortKey) {
        case 'publishedAt': return a.publishedAt ? new Date(a.publishedAt).getTime() : 0
        case 'readerCount': return a.readerCount
        // Articles without enough data sort below any real value.
        case 'completionRate': return a.completionRate ?? -1
        case 'medianProgress': return a.medianProgress ?? -1
      }
    }
    return [...articles].sort((a, b) =>
      sortDir === 'asc' ? value(a) - value(b) : value(b) - value(a)
    )
  }, [articles, sortKey, sortDir])

  const SortHeader = ({ label, k, hint }: { label: string; k: SortKey; hint?: string }) => (
    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
      <button
        onClick={() => toggleSort(k)}
        title={hint}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--fg)] transition-colors ${
          sortKey === k ? 'text-[var(--fg)]' : ''
        }`}
      >
        {label}
        {sortKey === k && (sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
      </button>
    </th>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 pl-10 md:pl-0">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Your Readers
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            How far signed-in readers get in each of your published articles.
          </p>
        </div>

        {isAdmin && authors.length > 0 && (
          <label className="shrink-0 flex items-center gap-2 text-xs text-[var(--fg-faint)]">
            <span className="hidden sm:inline uppercase tracking-widest font-bold">Author</span>
            <select
              value={authorId}
              onChange={(e) => setAuthorId(e.target.value)}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg)] hover:border-gold transition-colors"
            >
              {!authors.some((a) => a.id === currentUserId) && (
                <option value={currentUserId}>My articles</option>
              )}
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === currentUserId ? `${a.name} (me)` : a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* What these numbers mean, once, in plain English */}
      <div className="bg-gold/5 border border-gold/30 px-5 py-4 mb-6 text-sm text-[var(--fg-muted)] leading-relaxed">
        <p className="mb-1">
          <span className="font-semibold text-[var(--fg)]">Signed-in readers</span> is how many
          logged-in readers opened a piece. Guests read too, but we can only measure readers with
          an account, so treat these numbers as a sample, not the full audience.
        </p>
        <p className="mb-1">
          <span className="font-semibold text-[var(--fg)]">Finished</span> is the share of those
          readers who got past the 90% mark, which we count as finishing.
        </p>
        <p>
          <span className="font-semibold text-[var(--fg)]">Median furthest point</span> means half
          of your signed-in readers made it at least that far into the piece.
        </p>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
        {/* Article list */}
        <motion.div variants={fadeUp}>
          <TabCard title="Your published articles" icon={<BookOpenCheck size={13} />}>
            {articles === null ? (
              <div className="p-6 animate-pulse space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-9 bg-[var(--bg-subtle)]" />
                ))}
              </div>
            ) : listError ? (
              <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">
                Reader data could not be loaded. Please refresh and try again.
              </p>
            ) : sorted.length === 0 ? (
              <p className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">
                No published articles yet. Once a piece is published, you will see here how far
                readers get in it.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-6 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                        Article
                      </th>
                      <SortHeader label="Published" k="publishedAt" />
                      <SortHeader label="Signed-in readers" k="readerCount" hint="Logged-in readers who opened this piece" />
                      <SortHeader label="Finished" k="completionRate" hint="Share of signed-in readers who got past 90%" />
                      <SortHeader label="Median furthest point" k="medianProgress" hint="Half of signed-in readers got at least this far" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sorted.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => selectArticle(a.id)}
                        className={`cursor-pointer transition-colors ${
                          selectedId === a.id ? 'bg-gold/10' : 'hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        <td className="px-6 py-3">
                          <p className="font-medium text-[var(--fg)] line-clamp-1">{a.title}</p>
                          <p className="text-[10px] text-[var(--fg-faint)] mt-0.5">
                            {a.viewCount.toLocaleString()} total views, signed-in and guests
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs whitespace-nowrap">
                          {a.publishedAt ? format(new Date(a.publishedAt), 'd MMM yyyy') : ''}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-[var(--fg)] tabular-nums">
                          {a.readerCount.toLocaleString()}
                        </td>
                        {a.hasEnoughData ? (
                          <>
                            <td className="px-4 py-3 text-right tabular-nums">
                              <span className="text-gold font-bold">{a.completionRate}%</span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[var(--fg)]">
                              {a.medianProgress}%
                            </td>
                          </>
                        ) : (
                          <td colSpan={2} className="px-4 py-3 text-right text-xs text-[var(--fg-faint)]">
                            Not enough data yet
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-6 py-3 border-t border-[var(--border)] text-[11px] text-[var(--fg-faint)]">
                  Click an article to see where readers stop. Detailed charts appear once at least
                  5 signed-in readers have opened a piece.
                </p>
              </div>
            )}
          </TabCard>
        </motion.div>

        {/* Per-article drop-off detail */}
        {selectedId && (
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <TabCard
              title={detail ? `Where readers get to: ${detail.article.title}` : 'Where readers get to'}
              icon={<Users size={13} />}
            >
              {detailLoading || (!detail && selectedId) ? (
                detailLoading ? (
                  <div className="p-6 animate-pulse h-64 bg-[var(--bg-elevated)]" />
                ) : (
                  <p className="px-6 py-8 text-center text-[var(--fg-faint)] text-sm">
                    This article&apos;s reader data could not be loaded. Please try again.
                  </p>
                )
              ) : detail && !detail.stats.hasEnoughData ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-[var(--fg)] text-sm font-semibold mb-1">Not enough data yet</p>
                  <p className="text-[var(--fg-faint)] text-sm max-w-md mx-auto leading-relaxed">
                    {detail.stats.readerCount === 0
                      ? 'No signed-in readers have opened this piece so far.'
                      : `${detail.stats.readerCount} signed-in ${detail.stats.readerCount === 1 ? 'reader has' : 'readers have'} opened this piece so far.`}{' '}
                    Once there are at least 5, you will see how far they get. Small samples can be
                    misleading, so we wait rather than guess.
                  </p>
                </div>
              ) : detail && detail.stats.retention ? (
                <DetailBody detail={detail} />
              ) : null}
            </TabCard>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}

function DetailBody({ detail }: { detail: ArticleDetail }) {
  const { stats } = detail
  const retention = stats.retention!
  const drop = stats.steepestDrop
  const halfway = retention.find((r) => r.threshold === 50)

  const barData = {
    labels: retention.map((r) => `${r.threshold}%`),
    datasets: [
      {
        label: 'Readers who got past this point',
        data: retention.map((r) => r.share),
        backgroundColor: retention.map((r) =>
          drop && r.threshold === drop.to ? 'rgba(26,39,68,0.75)' : 'rgba(201,162,39,0.75)'
        ),
        borderWidth: 0,
        maxBarThickness: 48,
      },
    ],
  }

  const barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 2.6,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: COLORS.NAVY,
        titleColor: COLORS.GOLD,
        bodyColor: COLORS.CREAM,
        padding: 12,
        cornerRadius: 0,
        callbacks: {
          title: (items) => `Past the ${items[0]?.label} mark`,
          label: (item) => {
            const point = retention[item.dataIndex]
            return ` ${point.share}% of signed-in readers (${point.readers} of ${stats.readerCount})`
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: 'rgba(26,39,68,0.45)', font: { size: 10 } },
        border: { display: false },
      },
      y: {
        grid: { color: 'rgba(26,39,68,0.06)' },
        ticks: {
          color: 'rgba(26,39,68,0.45)',
          font: { size: 10 },
          maxTicksLimit: 5,
          callback: (v) => `${v}%`,
        },
        border: { display: false },
        beginAtZero: true,
        max: 100,
      },
    },
  }

  return (
    <div className="p-6 space-y-5">
      {/* Stat row */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">
            Signed-in readers
          </p>
          <p className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            {stats.readerCount.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">
            Finished (past 90%)
          </p>
          <p className="text-2xl font-bold text-gold" style={{ fontFamily: 'var(--font-serif)' }}>
            {stats.completionRate}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">
            Median furthest point
          </p>
          <p className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            {stats.medianProgress}%
          </p>
        </div>
      </div>

      {/* Retention chart */}
      <div>
        <Bar data={barData} options={barOptions} />
        <p className="text-[11px] text-[var(--fg-faint)] mt-2">
          Each bar is the share of this article&apos;s {stats.readerCount} signed-in readers who got
          past that point. Bars always step down from left to right; the steepest step is where the
          most readers stopped.
        </p>
      </div>

      {/* Plain-English takeaways */}
      <div className="border-t border-[var(--border)] pt-4 space-y-1.5 text-sm text-[var(--fg-muted)] leading-relaxed">
        {halfway && (
          <p>
            <span className="font-semibold text-[var(--fg)]">{halfway.share}%</span> of your
            signed-in readers made it past the halfway mark
            {stats.completionRate !== null && stats.completionRate > 0
              ? `, and ${stats.completionRate}% read it to the end. Every one of those finishes is earned.`
              : '.'}
          </p>
        )}
        {drop ? (
          <p>
            The biggest drop is {dropLabel(drop)}, where {drop.readersLost} of{' '}
            {stats.readerCount} readers ({drop.lostShare}%) stopped. That stretch is the most
            useful place to look at pacing or add a hook. Some drop-off is completely normal,
            every article ever written has it.
          </p>
        ) : (
          <p>
            No real drop-off to point at: your readers held on the whole way through. That is rare,
            nicely done.
          </p>
        )}
        <p className="text-[11px] text-[var(--fg-faint)] pt-1">
          Based on {stats.readerCount} signed-in readers. Progress is measured by how far each
          reader scrolled, so skimmers and careful readers count the same.
        </p>
      </div>
    </div>
  )
}
