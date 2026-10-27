'use client'

import { useEffect, useState } from 'react'
import { ClipboardCopy, CalendarDays } from 'lucide-react'

type WeeklyReview = {
  startDate: string; endDate: string; basis: string; historicalWarning: string | null
  current: {
    articleViews: number; sitePageViews: number; taggedLandings: number;
    newConfirmedActiveSubscribers: number
  }
  previous: { articleViews: number; sitePageViews: number; newConfirmedActiveSubscribers: number }
  changes: { articleViews: number | null; sitePageViews: number | null; subscribers: number | null }
  topArticles: { id:string; title:string; slug:string; views:number }[]
  priorities: string[]
}

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-[var(--fg-faint)]">Not comparable yet</span>
  return <span className={`text-xs font-semibold ${value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-500':'text-[var(--fg-faint)]'}`}>
    {value>0?'+':''}{value}% vs previous 7 days
  </span>
}

export function WeeklyGrowthReview() {
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    void fetch('/api/editorial/analytics/weekly-review', { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error('Weekly review unavailable'); return res.json() as Promise<WeeklyReview> })
      .then(data=>{if(!controller.signal.aborted) setReview(data)})
      .catch(()=>{if(!controller.signal.aborted) setError(true)})
    return () => controller.abort()
  }, [retry])

  const brief = review ? [
    `The Consilium · Weekly editorial growth review (${review.startDate} to ${review.endDate} UTC)`,
    `Article views: ${review.current.articleViews}; recorded site page views: ${review.current.sitePageViews}`,
    `Tagged campaign landings: ${review.current.taggedLandings}; newly confirmed and currently active subscribers: ${review.current.newConfirmedActiveSubscribers}`,
    'Leading articles:', ...review.topArticles.map(a => `- ${a.title}: ${a.views} views`),
    'Priorities:', ...review.priorities.map(a => `- ${a}`),
    review.historicalWarning ?? '',
    'Counts describe events rather than unique people; incomplete historic page tracking affects comparisons.',
  ].join('\n') : ''

  return <section className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]">
    <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
      <div className="flex gap-2 items-center">
        <CalendarDays size={13} className="text-[var(--fg-faint)]"/>
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">Weekly editorial growth review</h2>
      </div>
      {review && <button type="button" className="text-xs text-[var(--fg-muted)] hover:text-gold flex items-center gap-1"
        onClick={() => {void navigator.clipboard.writeText(brief).then(()=>setCopied(true)).catch(()=>setCopied(false))}}>
        <ClipboardCopy size={13}/>{copied?'Copied':'Copy briefing'}
      </button>}
    </div>
    <div className="p-6 space-y-4">
      {error && <div className="text-sm text-[var(--fg-muted)]">
        Could not load the weekly review. <button onClick={()=>{setError(false);setRetry(x=>x+1)}} className="underline hover:text-gold">Retry</button>
      </div>}
      {!review && !error && <p className="text-sm text-[var(--fg-faint)]">Preparing the latest complete seven-day review…</p>}
      {review && <>
        <p className="text-xs text-[var(--fg-faint)]">{review.basis} · {review.startDate} to {review.endDate}</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            {title:'Article views',value:review.current.articleViews,delta:review.changes.articleViews},
            {title:'Recorded site page views',value:review.current.sitePageViews,delta:review.changes.sitePageViews},
            {title:'Tagged campaign landings',value:review.current.taggedLandings,delta:null},
            {title:'New active confirmations',value:review.current.newConfirmedActiveSubscribers,delta:review.changes.subscribers},
          ]).map(item=><div key={item.title} className="bg-[var(--bg-subtle)] border border-[var(--border)] px-3 py-3 space-y-1">
            <p className="text-xs text-[var(--fg-faint)] uppercase tracking-wide">{item.title}</p>
            <p className="text-xl font-bold text-[var(--fg)] tabular-nums" style={{fontFamily:'var(--font-serif)'}}>{item.value.toLocaleString()}</p>
            {item.title!=='Tagged campaign landings' && <Trend value={item.delta}/>}
          </div>)}
        </div>
        {review.historicalWarning && <p className="text-xs text-[var(--fg-muted)] border-l-2 border-gold pl-3">{review.historicalWarning}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--fg)] mb-2">Most-read articles this week</h3>
            {review.topArticles.length === 0 ? <p className="text-sm text-[var(--fg-faint)]">No article views recorded.</p> :
              review.topArticles.map(a=><div className="flex justify-between gap-3 py-1.5 text-sm" key={a.id}>
                <span className="text-[var(--fg-muted)]">{a.title}</span>
                <span className="text-[var(--fg)] font-semibold tabular-nums shrink-0">{a.views}</span>
              </div>)}
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--fg)] mb-2">Suggested editorial actions</h3>
            <ul className="space-y-2 list-disc pl-4 text-sm text-[var(--fg-muted)]">
              {review.priorities.map((item,i)=><li key={i}>{item}</li>)}
            </ul>
          </div>
        </div>
        <p className="text-xs text-[var(--fg-faint)]">Event counts, not unique visitors. The report is generated on demand and does not send emails or publish externally.</p>
      </>}
    </div>
  </section>
}
