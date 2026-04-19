'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

export interface DebateData {
  id: string
  title: string
  description: string | null
  isClosed: boolean
  closesAt: string | null
  forArticle: {
    id: string
    title: string
    slug: string
    excerpt: string | null
    author: string | null
    readTime: string
  }
  againstArticle: {
    id: string
    title: string
    slug: string
    excerpt: string | null
    author: string | null
    readTime: string
  }
  hasVoted: boolean
  userSide: 'FOR' | 'AGAINST' | null
  totalVotes: number
  forCount?: number
  againstCount?: number
  forPct?: number
  againstPct?: number
}

interface Props {
  initialData: DebateData
}

export function DebatePanel({ initialData }: Props) {
  const [data, setData] = useState<DebateData>(initialData)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function vote(side: 'FOR' | 'AGAINST') {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/debates/${data.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side }),
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong. Please try again.')
        return
      }
      setData((prev) => ({
        ...prev,
        hasVoted: true,
        userSide: side,
        totalVotes: json.totalVotes,
        forCount: json.forCount,
        againstCount: json.againstCount,
        forPct: json.forPct,
        againstPct: json.againstPct,
      }))
    })
  }

  const showResults = data.hasVoted || data.isClosed

  return (
    <section
      className="mt-14 border-t border-[var(--border)] pt-10"
      aria-label="Opinion debate"
    >
      {/* Section header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-gold/50 text-[0.65rem] font-bold tracking-[0.3em] uppercase">
          Debate
        </span>
        <div className="flex-1 h-px bg-[var(--border)]" />
        {data.isClosed && (
          <span className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest">
            Voting closed
          </span>
        )}
      </div>

      <div className="mb-4">
        <h2
          className="text-2xl sm:text-3xl font-bold text-[var(--fg)] leading-tight mb-2"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {data.title}
        </h2>
        {data.description && (
          <p className="text-[var(--fg-muted)] text-sm">{data.description}</p>
        )}
      </div>

      {/* Article cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* FOR side */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden card-hover group/for">
          <div className="h-1 bg-navy" />
          <div className="p-5">
            <span className="text-navy text-[0.6rem] font-bold uppercase tracking-[0.25em] mb-2 block">
              The Case For
            </span>
            <h3
              className="font-bold text-[var(--fg)] group-hover/for:text-navy text-base leading-snug mb-2 transition-colors duration-200"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {data.forArticle.title}
            </h3>
            {data.forArticle.excerpt && (
              <p className="text-[var(--fg-muted)] text-sm leading-relaxed line-clamp-3 mb-3">
                {data.forArticle.excerpt}
              </p>
            )}
            <div className="flex items-center justify-between text-xs text-[var(--fg-faint)]">
              <span>{data.forArticle.author}</span>
              <span>{data.forArticle.readTime}</span>
            </div>
            <Link
              href={`/articles/${data.forArticle.slug}`}
              className="mt-3 inline-flex items-center gap-2 text-navy text-xs font-bold uppercase tracking-widest group/link hover:gap-3 transition-all duration-200"
            >
              Read the argument
              <span className="inline-block transition-transform duration-200 group-hover/link:translate-x-1">→</span>
            </Link>
          </div>
        </div>

        {/* AGAINST side */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden card-hover group/against">
          <div className="h-1 bg-gold" />
          <div className="p-5">
            <span className="text-gold text-[0.6rem] font-bold uppercase tracking-[0.25em] mb-2 block">
              The Case Against
            </span>
            <h3
              className="font-bold text-[var(--fg)] group-hover/against:text-gold text-base leading-snug mb-2 transition-colors duration-200"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {data.againstArticle.title}
            </h3>
            {data.againstArticle.excerpt && (
              <p className="text-[var(--fg-muted)] text-sm leading-relaxed line-clamp-3 mb-3">
                {data.againstArticle.excerpt}
              </p>
            )}
            <div className="flex items-center justify-between text-xs text-[var(--fg-faint)]">
              <span>{data.againstArticle.author}</span>
              <span>{data.againstArticle.readTime}</span>
            </div>
            <Link
              href={`/articles/${data.againstArticle.slug}`}
              className="mt-3 inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest group/link hover:gap-3 transition-all duration-200"
            >
              Read the argument
              <span className="inline-block transition-transform duration-200 group-hover/link:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Voting row */}
      {!showResults ? (
        <div>
          <p className="text-[var(--fg-muted)] text-xs text-center mb-3 uppercase tracking-widest">
            Read both sides, then cast your vote
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => vote('FOR')}
              disabled={isPending}
              aria-label="Vote for the For side of this debate"
              className="flex-1 max-w-[220px] bg-navy text-cream text-xs font-bold uppercase tracking-widest py-3 px-6 hover:bg-navy/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : "I'm For This"}
            </button>
            <button
              onClick={() => vote('AGAINST')}
              disabled={isPending}
              aria-label="Vote for the Against side of this debate"
              className="flex-1 max-w-[220px] bg-gold text-navy text-xs font-bold uppercase tracking-widest py-3 px-6 hover:bg-gold/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : "I'm Against This"}
            </button>
          </div>
          {error && (
            <p className="text-red-600 text-xs text-center mt-2">{error}</p>
          )}
        </div>
      ) : (
        <div>
          {/* Results bars */}
          <div className="space-y-2 mb-3">
            {/* FOR bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span
                  className={`font-bold uppercase tracking-wider ${data.userSide === 'FOR' ? 'text-navy' : 'text-[var(--fg-muted)]'}`}
                >
                  For{data.userSide === 'FOR' && ' ✓'}
                </span>
                <span className="font-bold text-[var(--fg)]">{data.forPct ?? 0}%</span>
              </div>
              <div
                role="meter"
                aria-label="For votes"
                aria-valuenow={data.forPct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-3 bg-[var(--bg-subtle)] overflow-hidden"
              >
                <div
                  className="h-full bg-navy transition-all duration-700 ease-out"
                  style={{ width: `${data.forPct ?? 0}%` }}
                />
              </div>
            </div>

            {/* AGAINST bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span
                  className={`font-bold uppercase tracking-wider ${data.userSide === 'AGAINST' ? 'text-gold' : 'text-[var(--fg-muted)]'}`}
                >
                  Against{data.userSide === 'AGAINST' && ' ✓'}
                </span>
                <span className="font-bold text-[var(--fg)]">{data.againstPct ?? 0}%</span>
              </div>
              <div
                role="meter"
                aria-label="Against votes"
                aria-valuenow={data.againstPct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-3 bg-[var(--bg-subtle)] overflow-hidden"
              >
                <div
                  className="h-full bg-gold transition-all duration-700 ease-out"
                  style={{ width: `${data.againstPct ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          <p className="text-[var(--fg-faint)] text-xs text-center">
            {(data.totalVotes ?? 0).toLocaleString()} vote{data.totalVotes !== 1 ? 's' : ''}
            {data.isClosed ? ' · Voting closed' : ''}
          </p>
          {error && (
            <p className="text-red-600 text-xs text-center mt-1">{error}</p>
          )}
        </div>
      )}
    </section>
  )
}
