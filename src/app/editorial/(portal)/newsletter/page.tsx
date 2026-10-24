'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Mail, PauseCircle, PlayCircle, Plus, RefreshCw, Send, Users } from 'lucide-react'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { CampaignStatus, KindBadge } from '@/components/newsletter/CampaignStatus'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { formatEditorialScheduleDisplay } from '@/lib/editorialSchedule'

interface CampaignRow {
  id: string
  kind: 'WEEKLY' | 'ALERT'
  editionKey: string
  status: string
  subject: string
  articleCount: number
  scheduledFor: string | null
  sentAt: string | null
  createdAt: string
  recipientCount: number | null
  deliveredCount: number
  blockedReason: string | null
  lastError: string | null
}

interface Overview {
  campaigns: CampaignRow[]
  settings: { paused: boolean; autoSend: boolean }
  delivery: { mode: 'resend' | 'capture' | 'disabled'; reason?: string }
  audience: { active: number; weekly: number; alerts: number; pending: number; legacy: number; unsubscribed: number; suppressed: number; unsynced: number }
  schedule: { editionKey: string; sendAt: string; cutoff: string }
  permissions: { canEdit: boolean; canApprove: boolean; canPause: boolean; canUnpause: boolean }
}

interface AlertCandidate {
  id: string
  title: string
  author: string | null
  publishedAt: string | null
  hasAlert: boolean
}

const card = 'bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-4 sm:p-5'
const label = 'text-[var(--fg-faint)] text-[10px] uppercase tracking-widest mb-1'
const button =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold'

function when(row: CampaignRow) {
  if (row.sentAt) return `Sent ${formatEditorialScheduleDisplay(row.sentAt, { includeZone: true })}`
  if (row.scheduledFor) return `Sends ${formatEditorialScheduleDisplay(row.scheduledFor, { includeZone: true })}`
  return `Built ${formatEditorialScheduleDisplay(row.createdAt, { includeZone: true })}`
}

export default function NewsletterPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [candidates, setCandidates] = useState<AlertCandidate[] | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Overview>('/api/editorial/newsletter/campaigns'))
      setError(null)
    } catch (reason) {
      setError(asApiError(reason).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(key: string, run: () => Promise<unknown>, success: string) {
    setBusy(key)
    setNotice(null)
    try {
      await run()
      setNotice(success)
      await load()
    } catch (reason) {
      setNotice(asApiError(reason).message)
    } finally {
      setBusy(null)
    }
  }

  const setPaused = (paused: boolean) =>
    act('pause', () => apiRequest('/api/editorial/newsletter/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }), paused ? 'All newsletter sending is paused.' : 'Sending is live. Only approved campaigns are sent.')

  const setAutoSend = (autoSend: boolean) =>
    act('autosend', () => apiRequest('/api/editorial/newsletter/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSend }) }), autoSend ? 'Weekly editions will be approved automatically at cut-off.' : 'Weekly editions now need an administrator’s approval.')

  const buildWeekly = () =>
    act('build', () => apiRequest('/api/editorial/newsletter/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'build_weekly' }) }), 'This week’s edition is ready to preview.')

  async function openAlerts() {
    setAlertsOpen((open) => !open)
    if (candidates) return
    try {
      setCandidates((await apiRequest<{ articles: AlertCandidate[] }>('/api/editorial/newsletter/alerts')).articles)
    } catch (reason) {
      setNotice(asApiError(reason).message)
    }
  }

  const createAlert = (articleId: string) =>
    act(`alert:${articleId}`, async () => {
      await apiRequest('/api/editorial/newsletter/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articleId }) })
      setCandidates(null)
      setAlertsOpen(false)
    }, 'Special alert drafted. An administrator must approve it.')

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <PortalSection className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)] mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
          Newsletter
        </h1>
        <p className="text-[var(--fg-muted)] text-sm max-w-2xl">
          The Weekly Edition goes out on Fridays at 18:00 UK time with articles published at least an hour earlier. Nothing is sent without an administrator&apos;s approval, and every send re-checks that each article is still public.
        </p>
      </PortalSection>

      {error ? (
        <div role="alert" className={`${card} text-red-600 text-sm`}>
          Could not load the newsletter: {error}
        </div>
      ) : !data ? (
        <div className={`${card} text-[var(--fg-faint)] text-sm`}>Loading…</div>
      ) : (
        <>
          <PortalSection className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className={`${card} ${data.settings.paused ? 'border-amber-500/50' : ''}`}>
              <p className={label}>Sending</p>
              <p className="flex items-center gap-2 text-lg font-bold text-[var(--fg)]">
                {data.settings.paused ? <PauseCircle size={18} className="text-amber-600" aria-hidden /> : <PlayCircle size={18} className="text-emerald-600" aria-hidden />}
                {data.settings.paused ? 'Paused' : 'Live'}
              </p>
              <p className="text-xs text-[var(--fg-muted)] mt-1">{data.settings.paused ? 'Nothing will be sent, even if approved.' : 'Approved campaigns send at their time.'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.settings.paused
                  ? data.permissions.canUnpause && (
                      <button type="button" onClick={() => setPaused(false)} disabled={busy !== null} className={`${button} bg-navy text-gold hover:bg-navy-light dark:bg-gold dark:text-navy`}>
                        Resume sending
                      </button>
                    )
                  : data.permissions.canPause && (
                      <button type="button" onClick={() => setPaused(true)} disabled={busy !== null} className={`${button} border border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10`}>
                        Pause all sending
                      </button>
                    )}
              </div>
            </div>

            <div className={card}>
              <p className={label}>Delivery</p>
              <p className="flex items-center gap-2 text-lg font-bold text-[var(--fg)]">
                <Send size={16} className="text-gold" aria-hidden />
                {data.delivery.mode === 'resend' ? 'Resend' : data.delivery.mode === 'capture' ? 'Captured locally' : 'Off'}
              </p>
              <p className="text-xs text-[var(--fg-muted)] mt-1 break-words">
                {data.delivery.mode === 'resend' ? 'Broadcasts to the confirmed segment, by topic.' : data.delivery.mode === 'capture' ? 'Test environment: written to a local file, never sent.' : data.delivery.reason}
              </p>
            </div>

            <div className={card}>
              <p className={label}>Next weekly edition</p>
              <p className="flex items-center gap-2 text-lg font-bold text-[var(--fg)]">
                <CalendarClock size={16} className="text-gold" aria-hidden />
                {formatEditorialScheduleDisplay(data.schedule.sendAt, { includeZone: true })}
              </p>
              <p className="text-xs text-[var(--fg-muted)] mt-1">Includes articles published by {formatEditorialScheduleDisplay(data.schedule.cutoff, { includeYear: false, includeZone: true })}.</p>
              {data.permissions.canApprove && (
                <label className="mt-3 flex items-center gap-2 text-xs text-[var(--fg-muted)] cursor-pointer">
                  <input type="checkbox" checked={data.settings.autoSend} disabled={busy !== null} onChange={(e) => setAutoSend(e.target.checked)} className="accent-[#c9a227]" />
                  Approve weekly editions automatically at cut-off
                </label>
              )}
            </div>

            <div className={card}>
              <p className={label}>Confirmed audience</p>
              <p className="flex items-center gap-2 text-lg font-bold text-[var(--fg)]">
                <Users size={16} className="text-gold" aria-hidden />
                {data.audience.weekly.toLocaleString()} weekly · {data.audience.alerts.toLocaleString()} alerts
              </p>
              <p className="text-xs text-[var(--fg-muted)] mt-1">
                {data.audience.pending} awaiting confirmation · {data.audience.legacy} legacy (not mailed) · {data.audience.unsubscribed} unsubscribed · {data.audience.suppressed} suppressed
              </p>
              {data.audience.unsynced > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {data.audience.unsynced} change(s) not yet synced to Resend. Sends wait until they are.
                </p>
              )}
            </div>
          </PortalSection>

          {data.permissions.canEdit && (
            <PortalSection className="flex flex-col sm:flex-row gap-3 mb-4">
              <button type="button" onClick={buildWeekly} disabled={busy !== null} className={`${button} bg-navy text-gold hover:bg-navy-light dark:bg-gold dark:text-navy`}>
                <RefreshCw size={13} aria-hidden className={busy === 'build' ? 'animate-spin' : ''} />
                Build this week&apos;s edition now
              </button>
              <button type="button" onClick={openAlerts} aria-expanded={alertsOpen} disabled={busy !== null} className={`${button} border border-[var(--border-strong)] text-[var(--fg)] hover:border-gold`}>
                <Plus size={13} aria-hidden />
                Prepare special alert
              </button>
            </PortalSection>
          )}

          {alertsOpen && (
            <PortalSection className={`${card} mb-6`}>
              <h2 className="text-sm font-bold text-[var(--fg)] mb-1">Special-article alert</h2>
              <p className="text-xs text-[var(--fg-muted)] mb-3">
                Only for exceptional pieces published in the last 72 hours. At most one alert a week and three a month, never within 12 hours of a weekly edition. Sent only to readers who opted in.
              </p>
              {!candidates ? (
                <p className="text-xs text-[var(--fg-faint)]">Loading…</p>
              ) : candidates.length === 0 ? (
                <p className="text-xs text-[var(--fg-faint)]">No articles were published in the last 72 hours.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {candidates.map((a) => (
                    <li key={a.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[var(--fg)]">{a.title}</p>
                        <p className="text-xs text-[var(--fg-faint)]">
                          {a.author ?? 'The Consilium'} · {a.publishedAt ? formatEditorialScheduleDisplay(a.publishedAt, { includeYear: false }) : ''}
                        </p>
                      </div>
                      <button type="button" disabled={a.hasAlert || busy !== null} onClick={() => createAlert(a.id)} className={`${button} border border-[var(--border-strong)] text-[var(--fg)] hover:border-gold`}>
                        {a.hasAlert ? 'Alert exists' : 'Draft alert'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PortalSection>
          )}

          <div aria-live="polite" className="min-h-[1.25rem] mb-3">
            {notice && <p className="text-sm text-[var(--fg)]">{notice}</p>}
          </div>

          <PortalSection>
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)]">
              {data.campaigns.length === 0 ? (
                <div className="px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
                  <Mail size={20} className="mx-auto mb-2 text-gold/60" aria-hidden />
                  No editions yet. The first weekly edition is built automatically at Friday&apos;s cut-off once the scheduler is switched on.
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {data.campaigns.map((row) => (
                    <li key={row.id}>
                      <Link href={`/editorial/newsletter/${row.id}`} className="block px-4 sm:px-6 py-4 hover:bg-[var(--bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold transition-colors">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <KindBadge kind={row.kind} />
                          <CampaignStatus status={row.status} />
                          <span className="text-xs text-[var(--fg-faint)]">{row.editionKey.replace(/^weekly:/, 'Friday ').replace(/^alert:.*/, 'Special alert')}</span>
                        </div>
                        <p className="text-sm font-semibold text-[var(--fg)] break-words">{row.subject}</p>
                        <p className="text-xs text-[var(--fg-muted)] mt-1">
                          {row.articleCount} article{row.articleCount === 1 ? '' : 's'} · {when(row)}
                          {row.recipientCount !== null ? ` · ${row.recipientCount} recipients, ${row.deliveredCount} delivered` : ''}
                        </p>
                        {(row.status === 'BLOCKED' || row.status === 'FAILED') && (row.blockedReason || row.lastError) ? (
                          <p className="text-xs text-red-700 dark:text-red-300 mt-1 line-clamp-2">{row.blockedReason ?? row.lastError}</p>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PortalSection>
        </>
      )}
    </PortalPage>
  )
}
