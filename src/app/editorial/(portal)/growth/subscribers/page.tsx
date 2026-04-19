'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, Download, Users } from 'lucide-react'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { format } from 'date-fns'

interface Subscriber {
  id: string
  email: string
  subscribedAt: string
}

export default function SubscribersPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/editorial/growth/subscribers')
      .then((r) => {
        if (!r.ok) throw new Error('Unauthorised')
        return r.json()
      })
      .then((data) => setSubscribers(data.subscribers ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const filtered = subscribers.filter((s) =>
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  const exportCSV = useCallback(() => {
    const rows = [
      ['Email', 'Subscribed At', 'Status'],
      ...subscribers.map((s) => [
        s.email,
        format(new Date(s.subscribedAt), 'yyyy-MM-dd HH:mm'),
        'Active',
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `subscribers-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [subscribers])

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <PortalSection className="flex items-start justify-between mb-6 sm:mb-8">
        <div className="pl-10 md:pl-0">
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Subscribers
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            Newsletter subscriber list and export.
          </p>
        </div>
      </PortalSection>

      {/* Total count */}
      <PortalSection className="mb-6">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 sm:p-5 shadow-[var(--shadow-card)] inline-flex items-center gap-3">
          <Users size={18} className="text-gold/60 shrink-0" />
          <div>
            <p className="text-[var(--fg-faint)] text-[10px] uppercase tracking-widest mb-0.5">Total Subscribers</p>
            <p
              className="text-3xl font-bold text-[var(--fg)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {loading ? '—' : subscribers.length.toLocaleString()}
            </p>
          </div>
        </div>
      </PortalSection>

      {/* Search + export toolbar */}
      <PortalSection className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg)] placeholder-[var(--fg-faint)] outline-none focus:border-gold/50 transition-colors"
          />
        </div>
        <button
          onClick={exportCSV}
          disabled={loading || subscribers.length === 0}
          className="inline-flex items-center gap-2 bg-navy text-gold px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={13} />
          Export CSV
        </button>
      </PortalSection>

      {/* Table */}
      <PortalSection>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          {error ? (
            <div className="px-6 py-12 text-center text-red-500 text-sm">
              Failed to load subscribers. Please refresh.
            </div>
          ) : loading ? (
            <div className="px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
              {search ? 'No subscribers match your search.' : 'No subscribers yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-6 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">
                      Subscribed
                    </th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filtered.map((sub) => (
                    <tr key={sub.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-6 py-3 font-medium text-[var(--fg)] text-sm">
                        {sub.email}
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden sm:table-cell">
                        {format(new Date(sub.subscribedAt), 'd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-bold px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {search && (
                <p className="px-6 py-3 text-xs text-[var(--fg-faint)] border-t border-[var(--border)]">
                  Showing {filtered.length} of {subscribers.length} subscribers
                </p>
              )}
            </div>
          )}
        </div>
      </PortalSection>
    </PortalPage>
  )
}
