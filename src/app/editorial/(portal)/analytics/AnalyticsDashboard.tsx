'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
type LoadingSet = Set<TabId>

export function AnalyticsDashboard({ userRole: _userRole }: { userRole: string }) {
  const [period, setPeriod]           = useState<Period>('30d')
  const [activeTab, setActiveTab]     = useState<TabId>('overview')
  const [tabCache, setTabCache]       = useState<TabCache>({})
  const [loadingTabs, setLoadingTabs] = useState<LoadingSet>(new Set())
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch data for a tab (lazy, cached per period)
  const fetchTab = useCallback(async (tab: TabId, p: Period) => {
    setLoadingTabs(prev => new Set(prev).add(tab))
    try {
      const res = await fetch(`/api/editorial/analytics?period=${p}&tab=${tab}`)
      if (res.ok) {
        const json = await res.json()
        setTabCache(prev => ({ ...prev, [tab]: json }))
      }
    } finally {
      setLoadingTabs(prev => { const s = new Set(prev); s.delete(tab); return s })
    }
  }, [])

  // When period changes, clear cache and re-fetch current tab
  useEffect(() => {
    setTabCache({})
    fetchTab(activeTab, period)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  // When tab changes, fetch if not cached
  useEffect(() => {
    if (!tabCache[activeTab]) {
      fetchTab(activeTab, period)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

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

  const handleTabClick = (tab: TabId) => {
    setActiveTab(tab)
    if (!tabCache[tab]) fetchTab(tab, period)
  }

  const isLoading = (tab: TabId) => loadingTabs.has(tab)

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
            onClick={() => handleTabClick(tab.id)}
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

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && (
          <OverviewTab data={tabCache.overview ?? null} loading={isLoading('overview')} period={period} />
        )}
        {activeTab === 'content' && (
          <ContentTab data={tabCache.content ?? null} loading={isLoading('content')} />
        )}
        {activeTab === 'audience' && (
          <AudienceTab data={tabCache.audience ?? null} loading={isLoading('audience')} />
        )}
        {activeTab === 'engagement' && (
          <EngagementTab data={tabCache.engagement ?? null} loading={isLoading('engagement')} />
        )}
        {activeTab === 'leaderboard' && (
          <LeaderboardTab data={tabCache.leaderboard ?? null} loading={isLoading('leaderboard')} period={period} />
        )}
        {activeTab === 'distribution' && (
          <DistributionTab data={tabCache.distribution ?? null} loading={isLoading('distribution')} />
        )}
      </div>
    </div>
  )
}
