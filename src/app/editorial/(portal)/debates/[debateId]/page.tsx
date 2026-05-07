'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { COLORS } from '@/lib/constants'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
} from 'chart.js'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler)

interface VoteRow {
  side: string
  createdAt: string
}

interface DebateSummary {
  id: string
  title: string
  description: string | null
  isActive: boolean
  closesAt: string | null
  createdAt: string
  forArticle: { title: string; slug: string }
  againstArticle: { title: string; slug: string }
  totalVotes: number
  forCount: number
  againstCount: number
  forPct: number
  againstPct: number
  votes: VoteRow[]
}

export default function DebateAnalyticsPage({ params }: { params: Promise<{ debateId: string }> }) {
  const [debateId, setDebateId] = useState<string | null>(null)
  const [data, setData] = useState<DebateSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)
  const [page, setPage] = useState(0)
  const PER_PAGE = 20

  useEffect(() => {
    params.then((p) => setDebateId(p.debateId))
  }, [params])

  const fetchData = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/editorial/debates/${id}`)
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      setData(json)
    } catch {
      setError('Failed to load debate data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debateId) fetchData(debateId)
  }, [debateId, fetchData])

  useEffect(() => {
    if (!data || !chartRef.current) return
    if (chartInstance.current) chartInstance.current.destroy()

    // Build cumulative vote timeline
    const sorted = [...data.votes].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    // Bin by day
    const dayMap = new Map<string, { for: number; against: number }>()
    for (const vote of sorted) {
      const day = vote.createdAt.slice(0, 10)
      const existing = dayMap.get(day) ?? { for: 0, against: 0 }
      if (vote.side === 'FOR') existing.for++
      else existing.against++
      dayMap.set(day, existing)
    }

    const labels = Array.from(dayMap.keys()).sort()
    let cumFor = 0
    let cumAgainst = 0
    const forData: number[] = []
    const againstData: number[] = []
    for (const label of labels) {
      const d = dayMap.get(label)!
      cumFor += d.for
      cumAgainst += d.against
      forData.push(cumFor)
      againstData.push(cumAgainst)
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'For',
            data: forData,
            borderColor: COLORS.NAVY,
            backgroundColor: 'rgba(26,39,68,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Against',
            data: againstData,
            borderColor: '#c9a227',
            backgroundColor: 'rgba(201,162,39,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
        },
      },
    })
  }, [data])

  if (loading) return <div className="p-8 text-[var(--fg-faint)] text-sm">Loading…</div>
  if (error || !data) return <div className="p-8 text-red-600 text-sm">{error ?? 'Not found.'}</div>

  const pagedVotes = [...data.votes]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(data.votes.length / PER_PAGE)

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link href="/editorial/debates" className="text-[var(--fg-faint)] text-xs hover:text-gold transition-colors">
          ← All Debates
        </Link>
        <h1
          className="text-2xl font-bold text-[var(--fg)] mt-2"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {data.title}
        </h1>
        <div className="flex items-center gap-3 mt-1">
          <span
            className={`text-[0.6rem] font-bold uppercase tracking-[0.2em] px-2 py-0.5 ${
              data.isActive ? 'bg-green-500/15 text-green-600' : 'bg-[var(--border)] text-[var(--fg-faint)]'
            }`}
          >
            {data.isActive ? 'Active' : 'Inactive'}
          </span>
          <Link
            href={`/editorial/debates/${data.id}/edit`}
            className="text-xs text-gold hover:underline font-semibold"
          >
            Edit Debate
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Votes', value: data.totalVotes.toLocaleString() },
          { label: 'For', value: `${data.forCount} (${data.forPct}%)` },
          { label: 'Against', value: `${data.againstCount} (${data.againstPct}%)` },
        ].map((stat) => (
          <div key={stat.label} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
            <p className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Vote bars */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 mb-8 shadow-[var(--shadow-card)] space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-navy font-bold uppercase tracking-wider">For</span>
            <span className="text-[var(--fg-faint)]">{data.forPct}%</span>
          </div>
          <div className="h-3 bg-[var(--bg-subtle)]">
            <div className="h-full bg-navy transition-all duration-700" style={{ width: `${data.forPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gold font-bold uppercase tracking-wider">Against</span>
            <span className="text-[var(--fg-faint)]">{data.againstPct}%</span>
          </div>
          <div className="h-3 bg-[var(--bg-subtle)]">
            <div className="h-full bg-gold transition-all duration-700" style={{ width: `${data.againstPct}%` }} />
          </div>
        </div>
      </div>

      {/* Chart */}
      {data.votes.length > 0 && (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 mb-8 shadow-[var(--shadow-card)]">
          <p className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest mb-4">Cumulative Votes Over Time</p>
          <div className="h-56">
            <canvas ref={chartRef} />
          </div>
        </div>
      )}

      {/* Vote log */}
      {data.votes.length > 0 && (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]">
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <p className="text-[var(--fg)] font-semibold text-sm">Vote Log</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                <th className="px-6 py-3 text-left text-[var(--fg-faint)] uppercase tracking-wider font-semibold">#</th>
                <th className="px-6 py-3 text-left text-[var(--fg-faint)] uppercase tracking-wider font-semibold">Side</th>
                <th className="px-6 py-3 text-left text-[var(--fg-faint)] uppercase tracking-wider font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {pagedVotes.map((vote, i) => (
                <tr key={i} className="hover:bg-[var(--bg-subtle)] transition-colors">
                  <td className="px-6 py-3 text-[var(--fg-faint)]">{page * PER_PAGE + i + 1}</td>
                  <td className="px-6 py-3">
                    <span className={`font-bold uppercase tracking-widest ${vote.side === 'FOR' ? 'text-navy' : 'text-gold'}`}>
                      {vote.side}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[var(--fg-muted)]">
                    {new Date(vote.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs font-semibold text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-30 transition-colors"
              >
                ← Previous
              </button>
              <span className="text-[var(--fg-faint)] text-xs">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-xs font-semibold text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-30 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
