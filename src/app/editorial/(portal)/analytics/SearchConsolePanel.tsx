'use client'

import { useEffect, useState } from 'react'
import { Search, TrendingUp, ExternalLink } from 'lucide-react'
import type { Period } from './AnalyticsDashboard'
import type { SearchConsoleData, SearchResult } from '@/lib/searchConsoleAnalytics'

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="bg-[var(--bg-subtle)] border border-[var(--border)] px-4 py-3">
    <p className="text-xs uppercase tracking-widest text-[var(--fg-faint)] mb-1">{label}</p>
    <p className="text-2xl font-bold text-[var(--fg)] tabular-nums" style={{fontFamily:'var(--font-serif)'}}>{value}</p>
    {note && <p className="text-xs text-[var(--fg-muted)] mt-1">{note}</p>}
  </div>
}
const pct = (fraction: number) => (fraction * 100).toFixed(1) + '%'
const shortened = (url: string) => {
  try { return new URL(url).pathname || '/' } catch { return url }
}
function Results({ result }: { result: SearchConsoleData }) {
  return <div className="space-y-6">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Metric label="Google Search clicks" value={result.summary.clicks.toLocaleString()}
        note={result.comparison.changePct === null ? 'No comparable prior click baseline' :
          `${result.comparison.changePct > 0 ? '+' : ''}${result.comparison.changePct}% vs previous period`} />
      <Metric label="Search impressions" value={result.summary.impressions.toLocaleString()} />
      <Metric label="Search click-through rate" value={pct(result.summary.ctr)} />
      <Metric label="Average Search position" value={result.summary.position > 0 ? result.summary.position.toFixed(1) : '—'}
        note="Lower usually means higher placement" />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-faint)]">
      <span>Finalised Google web-search data · {result.startDate} to {result.endDate} (UTC)</span>
      <span>Updated {new Date(result.retrievedAt).toLocaleString('en-GB')}</span>
    </div>

    {result.opportunities.length > 0 && <div className="border border-[var(--border)] bg-[var(--bg-subtle)] p-5 space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--fg)]">Pages worth reviewing</h3>
      <p className="text-xs text-[var(--fg-muted)]">
        Heuristic shortlist: at least 20 impressions, average position 4–20 and CTR below 5%.
        This is a review opportunity, not proof that changing a headline will increase traffic.
      </p>
      {result.opportunities.map(page =>
        <div className="flex items-start justify-between gap-3 text-sm" key={page.label}>
          <a href={page.label} target="_blank" rel="noopener noreferrer"
            className="min-w-0 break-words text-[var(--fg)] underline underline-offset-2 hover:text-gold">{shortened(page.label)}</a>
          <span className="shrink-0 text-[var(--fg-muted)] tabular-nums">{page.impressions} impressions · {pct(page.ctr)} CTR</span>
        </div>
      )}
    </div>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h3 className="mb-3 text-xs uppercase tracking-widest font-bold text-[var(--fg)]">Top Google searches</h3>
        {result.topQueries.length === 0 ? <p className="text-sm text-[var(--fg-faint)]">No query rows returned for this period.</p> :
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead className="text-[var(--fg-faint)] uppercase border-b border-[var(--border)]">
            <tr><th className="text-left py-2 pr-3">Query</th><th className="text-right py-2">Clicks</th><th className="text-right py-2">Impr.</th><th className="text-right py-2">Pos.</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {result.topQueries.slice(0,10).map(item => <tr key={item.label}>
              <td className="py-2 pr-3 break-words text-[var(--fg)]">{item.label}</td>
              <td className="py-2 text-right tabular-nums">{item.clicks}</td>
              <td className="py-2 text-right tabular-nums">{item.impressions}</td>
              <td className="py-2 text-right tabular-nums">{item.position.toFixed(1)}</td>
            </tr>)}
          </tbody>
        </table></div>}
      </div>
      <div>
        <h3 className="mb-3 text-xs uppercase tracking-widest font-bold text-[var(--fg)]">Top pages from Google Search</h3>
        {result.topPages.length === 0 ? <p className="text-sm text-[var(--fg-faint)]">No page rows returned for this period.</p> :
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead className="text-[var(--fg-faint)] uppercase border-b border-[var(--border)]">
            <tr><th className="text-left py-2 pr-3">Page</th><th className="text-right py-2">Clicks</th><th className="text-right py-2">Impr.</th><th className="text-right py-2">CTR</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {result.topPages.slice(0,10).map(item => <tr key={item.label}>
              <td className="py-2 pr-3 break-all text-[var(--fg)]">
                <a href={item.label} target="_blank" rel="noopener noreferrer"
                  className="hover:text-gold underline underline-offset-2">{shortened(item.label)}</a>
              </td>
              <td className="py-2 text-right tabular-nums">{item.clicks}</td>
              <td className="py-2 text-right tabular-nums">{item.impressions}</td>
              <td className="py-2 text-right tabular-nums">{pct(item.ctr)}</td>
            </tr>)}
          </tbody>
        </table></div>}
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {result.devices.length > 0 && <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-[var(--fg)] mb-3">Search device breakdown</h3>
        {result.devices.map(device=><div key={device.label} className="flex justify-between text-sm py-1">
          <span className="capitalize text-[var(--fg-muted)]">{device.label}</span>
          <span className="font-semibold text-[var(--fg)]">{device.clicks} clicks · {device.impressions} impressions</span>
        </div>)}
      </div>}
      {result.daily.length > 0 && <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-[var(--fg)] mb-3">Daily Google Search clicks</h3>
        <div className="h-16 flex items-end gap-px" role="img" aria-label="Daily search clicks sparkline">
          {result.daily.map(point =>
            <div key={point.label} title={`${point.label}: ${point.clicks} clicks`}
              className="min-w-px flex-1 bg-gold/80"
              style={{height:`${Math.max(3,point.clicks / Math.max(1,...result.daily.map(d=>d.clicks)) * 100)}%`}} />
          )}
        </div>
      </div>}
    </div>
    <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
      Search Console clicks and impressions are Google Search metrics, not The Consilium's first-party page views.
      Query/page tables may omit anonymised or lower-volume rows and need not sum to the property total.
      Search data typically lags several days. No individual visitor data is imported.
    </p>
  </div>
}

export function SearchConsolePanel({ period }: { period: Period }) {
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    setError(false)
    void fetch(`/api/editorial/analytics/search-console?period=${period}`, { signal: controller.signal })
      .then(response => {if(!response.ok) throw new Error('Search metrics unavailable');return response.json() as Promise<SearchResult>})
      .then(data=>{if(!controller.signal.aborted) setResult(data)})
      .catch(()=>{if(!controller.signal.aborted) setError(true)})
    return () => controller.abort()
  }, [period, retry])

  return <section className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]">
    <div className="px-6 py-4 border-b border-[var(--border)] flex items-center gap-2">
      <Search size={13} className="text-[var(--fg-faint)]" />
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--fg)]">Google Search performance</h2>
      <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer"
        className="ml-auto flex items-center gap-1 text-xs text-[var(--fg-muted)] hover:text-gold">
        Search Console <ExternalLink size={12}/>
      </a>
    </div>
    <div className="p-6">
      {period==='24h' && <p className="text-xs text-[var(--fg-muted)] mb-3">Search Console does not provide a comparable live 24-hour report. Showing seven finalised days instead.</p>}
      {!result && !error && <p className="text-sm text-[var(--fg-faint)]">Loading Search Console metrics…</p>}
      {error && <div className="space-y-2 text-sm text-[var(--fg-muted)]"><p>Search performance could not be loaded.</p>
        <button className="underline hover:text-gold" onClick={()=>setRetry(v=>v+1)}>Try again</button></div>}
      {result?.status==='not_connected' && <div className="space-y-3 text-sm text-[var(--fg-muted)]">
        <p>Search Console is not connected to this dashboard. No Google search figures will be estimated or invented.</p>
        <p>To enable it, grant a read-only Google Cloud service account access to the verified Search Console property and add the three server-only environment variables described in the Phase 3 setup guide.</p>
      </div>}
      {result?.status==='unavailable' && <div className="space-y-2 text-sm text-[var(--fg-muted)]">
        <p>{result.message}</p>
        <button className="underline hover:text-gold" onClick={()=>setRetry(v=>v+1)}>Retry Search Console</button>
      </div>}
      {result?.status==='connected' && <Results result={result}/>}
    </div>
  </section>
}
