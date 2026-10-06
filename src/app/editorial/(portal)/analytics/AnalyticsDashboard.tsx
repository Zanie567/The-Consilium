'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { OverviewTab } from './OverviewTab'
import { ContentTab } from './ContentTab'
import { AudienceTab } from './AudienceTab'
import { EngagementTab } from './EngagementTab'
import { LeaderboardTab } from './LeaderboardTab'
import { DistributionTab } from './DistributionTab'
import type { OverviewData } from './OverviewTab'
import type { ContentData } from './ContentTab'
import type { AudienceData } from './AudienceTab'
import type { EngagementData } from './EngagementTab'
import type { LeaderboardData } from './LeaderboardTab'
import type { DistributionData } from './DistributionTab'

export type Period = '24h' | '7d' | '30d' | '90d'

const PERIOD_LABELS: Record<Period, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}

type TabId = 'overview' | 'content' | 'audience' | 'engagement' | 'leaderboard' | 'distribution'
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',     label: 'Overview' },
  { id: 'content',      label: 'Content' },
  { id: 'audience',     label: 'Audience' },
  { id: 'engagement',   label: 'Engagement' },
  { id: 'leaderboard',  label: 'Writers' },
  { id: 'distribution', label: 'Distribution' },
]

interface TabCache {
  overview?: OverviewData
  content?: ContentData
  audience?: AudienceData
  engagement?: EngagementData
  leaderboard?: LeaderboardData
  distribution?: DistributionData
}

export function AnalyticsDashboard({ userRole: _userRole }: { userRole: string }) {
  const [period, setPeriod]           = useState<Period>('30d')
  const [activeTab, setActiveTab]     = useState<TabId>('overview')
  const [tabCache, setTabCache]       = useState<TabCache>({})
  const [cachePeriod, setCachePeriod] = useState<Period>('30d')
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const cache = useRef<{ period: Period; data: TabCache }>({ period: '30d', data: {} })
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // One effect owns the selected request. Aborted/obsolete selections cannot
  // replace the current period, hide its spinner or display an unrelated error.
  useEffect(() => {
    if (cache.current.period !== period) {
      cache.current = { period, data: {} }
      setTabCache({})
      setCachePeriod(period)
    }
    setError(null)
    if (cache.current.data[activeTab]) {
      setLoadingKey(null)
      return
    }
    const controller = new AbortController()
    const key = `${period}:${activeTab}`
    setLoadingKey(key)
    void (async () => {
      try {
        const res = await fetch(`/api/editorial/analytics?period=${period}&tab=${activeTab}`, { signal: controller.signal })
        if (res.status !== 200) throw new Error(`Analytics could not be loaded (${res.status}).`)
        const json = await res.json()
        if (controller.signal.aborted) return
        cache.current.data = { ...cache.current.data, [activeTab]: json }
        setTabCache(cache.current.data)
      } catch (failure) {
        if (!controller.signal.aborted) setError({ key, message: failure instanceof Error ? failure.message : 'Analytics could not be loaded. Please retry.' })
      } finally {
        if (!controller.signal.aborted) setLoadingKey(null)
      }
    })()
    return () => controller.abort()
  }, [activeTab, period, retry])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isLoading = (tab: TabId) => cachePeriod !== period || loadingKey === `${period}:${tab}`
  const selectedCache = cachePeriod === period ? tabCache : {}
  const selectedError = error?.key === `${period}:${activeTab}` ? error.message : null

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 pl-10 md:pl-0">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Analytics
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">Site performance and readership insights.</p>
        </div>

        {/* Period dropdown */}
        <div ref={dropdownRef} className="relative shrink-0">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--fg)] hover:border-gold transition-colors"
          >
            {PERIOD_LABELS[period]}
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-1 w-44 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] z-20 overflow-hidden"
              >
                {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                  <button
                    key={p}
                    onClick={() => { setPeriod(p); setDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-medium tracking-wide transition-colors ${
                      period === p
                        ? 'bg-gold/10 text-gold font-bold'
                        : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--border)] mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'shrink-0 pb-2.5 mr-5 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-gold text-[var(--fg)]'
                : 'border-transparent text-[var(--fg-faint)] hover:text-[var(--fg-muted)]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {selectedError && (
        <div role="alert" className="mb-4 border border-red-500/30 p-4 text-sm text-red-500">
          <p>{selectedError}</p>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 underline">Retry analytics</button>
        </div>
      )}

      {/* Failed data has its explicit retry above, not an endless loading skeleton. */}
      {!selectedError && <div>
        {activeTab === 'overview' && (
          <OverviewTab data={selectedCache.overview ?? null} loading={isLoading('overview')} period={period} />
        )}
        {activeTab === 'content' && (
          <ContentTab data={selectedCache.content ?? null} loading={isLoading('content')} />
        )}
        {activeTab === 'audience' && (
          <AudienceTab data={selectedCache.audience ?? null} loading={isLoading('audience')} />
        )}
        {activeTab === 'engagement' && (
          <EngagementTab data={selectedCache.engagement ?? null} loading={isLoading('engagement')} />
        )}
        {activeTab === 'leaderboard' && (
          <LeaderboardTab data={selectedCache.leaderboard ?? null} loading={isLoading('leaderboard')} period={period} />
        )}
        {activeTab === 'distribution' && (
          <DistributionTab data={selectedCache.distribution ?? null} loading={isLoading('distribution')} />
        )}
      </div>}
    </div>
  )
}
