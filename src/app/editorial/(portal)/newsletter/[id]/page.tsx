'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Monitor, RefreshCw, Smartphone, XCircle } from 'lucide-react'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { CampaignStatus, KindBadge } from '@/components/newsletter/CampaignStatus'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { EDITORIAL_TIME_ZONE_LABEL, formatEditorialScheduleDisplay, getEditorialScheduleMinInput, parseEditorialScheduleInput } from '@/lib/editorialSchedule'

interface Item {
  id: string
  title: string
  author: string
  summary: string | null
  url: string
  imageUrl: string | null
  publishedAt: string
}

interface Detail {
  campaign: {
    id: string
    kind: 'WEEKLY' | 'ALERT'
    editionKey: string
    status: string
    subject: string
    previewText: string | null
    intro: string | null
    contentHash: string
    scheduledFor: string | null
    sentAt: string | null
    approvedAt: string | null
    approvedByName: string | null
    createdByName: string | null
    cancelReason: string | null
    blockedReason: string | null
    lastError: string | null
    nextAttemptAt: string | null
    windowStart: string | null
    windowEnd: string | null
    sendAttempts: number
    resendBroadcastId: string | null
    recipientCount: number | null
    deliveredCount: number
    bouncedCount: number
    complainedCount: number
  }
  content: { items: Item[]; excluded: { id: string; title: string; reason: string }[] }
  previewHtml: string
  previewText: string
  audit: { id: string; action: string; at: string; actor: string }[]
  permissions: { canEdit: boolean; canApprove: boolean }
}

const card = 'bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-4 sm:p-5'
const button =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold'
const primary = `${button} bg-navy text-gold hover:bg-navy-light dark:bg-gold dark:text-navy`
const secondary = `${button} border border-[var(--border-strong)] text-[var(--fg)] hover:border-gold`
const field = 'w-full bg-[var(--bg)] border border-[var(--border-strong)] text-[var(--fg)] px-3 py-2 text-sm focus:outline-none focus:border-gold'
const fmt = (value: string | null) => (value ? formatEditorialScheduleDisplay(value, { includeZone: true }) : '—')

const ACTION_LABELS: Record<string, string> = {
  built: 'Edition built',
  skipped: 'Skipped (nothing eligible)',
  rebuilt: 'Rebuilt from published articles',
  edited: 'Content edited (approval cleared)',
  approved: 'Approved and scheduled',
  cancelled: 'Cancelled',
  alert_created: 'Special alert drafted',
  blocked: 'Blocked by the send-time safety check',
  attempt_failed: 'Send attempt failed (will retry)',
  failed: 'Send failed (needs attention)',
  sent: 'Handed to Resend',
  skipped_no_recipients: 'Skipped: no opted-in subscribers',
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [view, setView] = useState<'html' | 'text'>('html')
  const [sendAt, setSendAt] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ subject: string; previewText: string; intro: string; summaries: Record<string, string>; remove: Set<string> } | null>(null)

  const load = useCallback(async () => {
    try {
      setDetail(await apiRequest<Detail>(`/api/editorial/newsletter/campaigns/${id}`))
      setError(null)
    } catch (reason) {
      setError(asApiError(reason).message)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(body: Record<string, unknown>, success: string) {
    setBusy(true)
    setNotice(null)
    try {
      setDetail(await apiRequest<Detail>(`/api/editorial/newsletter/campaigns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      setNotice({ kind: 'ok', text: success })
      return true
    } catch (reason) {
      setNotice({ kind: 'error', text: asApiError(reason).message })
      await load()
      return false
    } finally {
      setBusy(false)
    }
  }

  const c = detail?.campaign
  const editable = Boolean(c && detail?.permissions.canEdit && ['DRAFT', 'SCHEDULED', 'BLOCKED'].includes(c.status))
  const rebuildable = Boolean(c && detail?.permissions.canEdit && ['DRAFT', 'SCHEDULED', 'BLOCKED', 'SKIPPED'].includes(c.status))
  const cancellable = Boolean(c && detail?.permissions.canEdit && ['DRAFT', 'SCHEDULED', 'BLOCKED', 'FAILED', 'SKIPPED'].includes(c.status))
  const approvable = Boolean(c && detail?.permissions.canApprove && c.status === 'DRAFT' && detail.content.items.length > 0)

  const sendAtError = useMemo(() => (sendAt && !parseEditorialScheduleInput(sendAt) ? 'Enter a valid UK date and time.' : null), [sendAt])

  function startEditing() {
    if (!detail) return
    setDraft({
      subject: detail.campaign.subject,
      previewText: detail.campaign.previewText ?? '',
      intro: detail.campaign.intro ?? '',
      summaries: Object.fromEntries(detail.content.items.map((i) => [i.id, i.summary ?? ''])),
      remove: new Set(),
    })
    setEditing(true)
  }

  async function saveEdits() {
    if (!draft) return
    const ok = await patch(
      { action: 'edit', subject: draft.subject, previewText: draft.previewText || null, intro: draft.intro || null, summaries: draft.summaries, removeArticleIds: [...draft.remove] },
      'Saved. The edition is a draft again and needs approval.',
    )
    if (ok) setEditing(false)
  }

  async function approve() {
    if (!detail) return
    const scheduled = sendAt ? parseEditorialScheduleInput(sendAt) : null
    if (sendAt && !scheduled) return
    await patch({ action: 'approve', expectedHash: detail.campaign.contentHash, scheduledFor: scheduled ? scheduled.toISOString() : null }, 'Approved. It will be sent at the scheduled time unless sending is paused.')
  }

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <PortalSection className="mb-4 pl-10 md:pl-0">
        <Link href="/editorial/newsletter" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] hover:text-gold">
          <ArrowLeft size={13} aria-hidden /> All editions
        </Link>
      </PortalSection>

      {error ? (
        <div role="alert" className={`${card} text-red-600 text-sm`}>
          {error}
        </div>
      ) : !detail || !c ? (
        <div className={`${card} text-[var(--fg-faint)] text-sm`}>Loading…</div>
      ) : (
        <>
          <PortalSection className="mb-6">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <KindBadge kind={c.kind} />
              <CampaignStatus status={c.status} />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--fg)] break-words" style={{ fontFamily: 'var(--font-serif)' }}>
              {c.subject}
            </h1>
            {c.previewText && <p className="text-sm text-[var(--fg-muted)] mt-1">{c.previewText}</p>}
          </PortalSection>

          {(c.status === 'BLOCKED' || c.status === 'FAILED' || c.status === 'SKIPPED' || c.status === 'CANCELLED') && (c.blockedReason || c.lastError || c.cancelReason) ? (
            <PortalSection className={`${card} mb-6 border-red-500/40`}>
              <p className="text-xs font-bold uppercase tracking-widest text-red-700 dark:text-red-300 mb-2">
                {c.status === 'BLOCKED' ? 'Why it was blocked' : c.status === 'FAILED' ? 'Last error' : c.status === 'CANCELLED' ? 'Cancellation note' : 'Note'}
              </p>
              <p className="text-sm text-[var(--fg)] whitespace-pre-line break-words">{c.blockedReason ?? c.lastError ?? c.cancelReason}</p>
              {c.status === 'FAILED' && c.nextAttemptAt && <p className="text-xs text-[var(--fg-muted)] mt-2">Next automatic retry: {fmt(c.nextAttemptAt)}</p>}
              {c.status === 'BLOCKED' && <p className="text-xs text-[var(--fg-muted)] mt-2">Rebuild the edition from what is currently published, check the preview, then approve it again.</p>}
            </PortalSection>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
            <div className="min-w-0 space-y-6">
              <PortalSection className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h2 className="text-sm font-bold text-[var(--fg)]">Preview</h2>
                  <div className="flex gap-1" role="group" aria-label="Preview options">
                    <button type="button" aria-pressed={view === 'html' && width === 'desktop'} onClick={() => { setView('html'); setWidth('desktop') }} className={`${secondary} !px-2.5`}>
                      <Monitor size={13} aria-hidden /> <span className="sr-only sm:not-sr-only">Desktop</span>
                    </button>
                    <button type="button" aria-pressed={view === 'html' && width === 'mobile'} onClick={() => { setView('html'); setWidth('mobile') }} className={`${secondary} !px-2.5`}>
                      <Smartphone size={13} aria-hidden /> <span className="sr-only sm:not-sr-only">Mobile</span>
                    </button>
                    <button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')} className={`${secondary} !px-2.5`}>
                      Text
                    </button>
                  </div>
                </div>
                {view === 'html' ? (
                  <div className="bg-[#faf8f3] border border-[var(--border)] overflow-x-auto">
                    {/* sandbox with no permissions: the preview can run nothing and navigate nowhere */}
                    <iframe title="Email preview" sandbox="" srcDoc={detail.previewHtml} className="block mx-auto bg-white" style={{ width: width === 'desktop' ? 640 : 375, maxWidth: '100%', height: 900, border: 0 }} />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-xs text-[var(--fg)] bg-[var(--bg-subtle)] p-4 max-h-[900px] overflow-auto">{detail.previewText}</pre>
                )}
                <p className="text-[11px] text-[var(--fg-faint)] mt-2">Resend replaces the unsubscribe link with each recipient&apos;s own one-click link.</p>
              </PortalSection>

              {editing && draft ? (
                <PortalSection className={card}>
                  <h2 className="text-sm font-bold text-[var(--fg)] mb-3">Edit content</h2>
                  <div className="space-y-4">
                    <label className="block">
                      <span className="block text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] mb-1">Subject</span>
                      <input className={field} maxLength={150} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] mb-1">Inbox preview text</span>
                      <input className={field} maxLength={200} value={draft.previewText} onChange={(e) => setDraft({ ...draft, previewText: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] mb-1">Editor&apos;s introduction (optional)</span>
                      <textarea className={`${field} min-h-[96px]`} maxLength={2000} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
                    </label>
                    {detail.content.items.map((item) => (
                      <fieldset key={item.id} className="border-t border-[var(--border)] pt-4">
                        <legend className="text-sm font-semibold text-[var(--fg)] pr-2">{item.title}</legend>
                        <label className="block mt-2">
                          <span className="block text-xs text-[var(--fg-muted)] mb-1">Approved summary (defaults to the published excerpt)</span>
                          <textarea className={`${field} min-h-[72px]`} maxLength={600} value={draft.summaries[item.id] ?? ''} onChange={(e) => setDraft({ ...draft, summaries: { ...draft.summaries, [item.id]: e.target.value } })} />
                        </label>
                        {c.kind === 'WEEKLY' && (
                          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--fg-muted)] cursor-pointer">
                            <input
                              type="checkbox"
                              className="accent-[#c9a227]"
                              checked={draft.remove.has(item.id)}
                              onChange={(e) => {
                                const remove = new Set(draft.remove)
                                if (e.target.checked) remove.add(item.id)
                                else remove.delete(item.id)
                                setDraft({ ...draft, remove })
                              }}
                            />
                            Leave this article out of the edition
                          </label>
                        )}
                      </fieldset>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={saveEdits} disabled={busy} className={primary}>
                        Save changes
                      </button>
                      <button type="button" onClick={() => setEditing(false)} disabled={busy} className={secondary}>
                        Discard
                      </button>
                    </div>
                  </div>
                </PortalSection>
              ) : null}

              {detail.content.excluded.length > 0 && (
                <PortalSection className={card}>
                  <h2 className="text-sm font-bold text-[var(--fg)] mb-2">Not included</h2>
                  <ul className="space-y-2">
                    {detail.content.excluded.map((x) => (
                      <li key={`${x.id}-${x.reason}`} className="text-xs">
                        <span className="font-semibold text-[var(--fg)]">{x.title}</span> <span className="text-[var(--fg-muted)]">— {x.reason}</span>
                      </li>
                    ))}
                  </ul>
                </PortalSection>
              )}
            </div>

            <aside className="space-y-6 min-w-0">
              <PortalSection className={card}>
                <h2 className="text-sm font-bold text-[var(--fg)] mb-3">Actions</h2>
                <div aria-live="polite" className="mb-3">
                  {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{notice.text}</p>}
                </div>

                {approvable && (
                  <div className="mb-5 pb-5 border-b border-[var(--border)]">
                    <label className="block text-xs font-bold uppercase tracking-widest text-[var(--fg-muted)] mb-1" htmlFor="send-at">
                      Send time ({EDITORIAL_TIME_ZONE_LABEL})
                    </label>
                    <input id="send-at" type="datetime-local" className={field} min={getEditorialScheduleMinInput()} value={sendAt} onChange={(e) => setSendAt(e.target.value)} aria-describedby="send-at-help" aria-invalid={Boolean(sendAtError) || undefined} />
                    <p id="send-at-help" className="text-[11px] text-[var(--fg-faint)] mt-1">
                      {c.kind === 'WEEKLY' ? 'Leave empty for Friday 18:00.' : 'Leave empty to send 10 minutes after approval (and never before the article has been public for an hour).'}
                    </p>
                    {sendAtError && <p role="alert" className="text-xs text-red-700 dark:text-red-300 mt-1">{sendAtError}</p>}
                    <button type="button" onClick={approve} disabled={busy || Boolean(sendAtError)} className={`${primary} mt-3 w-full`}>
                      <CheckCircle2 size={14} aria-hidden /> Approve this exact version
                    </button>
                    <p className="text-[11px] text-[var(--fg-faint)] mt-2">Approval is tied to the preview you see. Any later change returns the edition to draft.</p>
                  </div>
                )}
                {c.status === 'DRAFT' && !detail.permissions.canApprove && (
                  <p className="text-xs text-[var(--fg-muted)] mb-4">An administrator approves and schedules the send.</p>
                )}

                <div className="flex flex-col gap-2">
                  {editable && !editing && (
                    <button type="button" onClick={startEditing} disabled={busy} className={secondary}>
                      Edit subject, intro or summaries
                    </button>
                  )}
                  {rebuildable && (
                    <button type="button" onClick={() => patch({ action: 'rebuild' }, 'Rebuilt from currently published articles. Review and approve again.')} disabled={busy} className={secondary}>
                      <RefreshCw size={13} aria-hidden /> Rebuild from published articles
                    </button>
                  )}
                  {cancellable && !cancelling && (
                    <button type="button" onClick={() => setCancelling(true)} disabled={busy} className={`${secondary} hover:!border-red-500`}>
                      <XCircle size={13} aria-hidden /> Cancel this {c.kind === 'WEEKLY' ? 'edition' : 'alert'}
                    </button>
                  )}
                  {cancelling && (
                    <div className="border-l-2 border-red-500 pl-3 space-y-2">
                      <label className="block text-xs text-[var(--fg-muted)]" htmlFor="cancel-reason">
                        Reason (kept in the audit trail)
                      </label>
                      <input id="cancel-reason" className={field} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={async () => { if (await patch({ action: 'cancel', reason: cancelReason || null }, 'Cancelled. Nothing will be sent.')) setCancelling(false) }} className={`${button} bg-red-700 text-white hover:bg-red-800`}>
                          Confirm cancel
                        </button>
                        <button type="button" onClick={() => setCancelling(false)} className={secondary}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </PortalSection>

              <PortalSection className={card}>
                <h2 className="text-sm font-bold text-[var(--fg)] mb-3">Details</h2>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-[var(--fg-faint)]">Edition</dt>
                  <dd className="text-[var(--fg)] break-words">{c.editionKey}</dd>
                  {c.windowStart && (
                    <>
                      <dt className="text-[var(--fg-faint)]">Published</dt>
                      <dd className="text-[var(--fg)]">{fmt(c.windowStart)} → {fmt(c.windowEnd)}</dd>
                    </>
                  )}
                  <dt className="text-[var(--fg-faint)]">Built by</dt>
                  <dd className="text-[var(--fg)]">{c.createdByName ?? 'Scheduler'}</dd>
                  <dt className="text-[var(--fg-faint)]">Approved</dt>
                  <dd className="text-[var(--fg)]">{c.approvedAt ? `${fmt(c.approvedAt)} by ${c.approvedByName ?? 'unknown'}` : '—'}</dd>
                  <dt className="text-[var(--fg-faint)]">Scheduled</dt>
                  <dd className="text-[var(--fg)]">{fmt(c.scheduledFor)}</dd>
                  <dt className="text-[var(--fg-faint)]">Sent</dt>
                  <dd className="text-[var(--fg)]">{fmt(c.sentAt)}</dd>
                  <dt className="text-[var(--fg-faint)]">Attempts</dt>
                  <dd className="text-[var(--fg)]">{c.sendAttempts}</dd>
                  {c.recipientCount !== null && (
                    <>
                      <dt className="text-[var(--fg-faint)]">Delivery</dt>
                      <dd className="text-[var(--fg)]">{c.recipientCount} recipients · {c.deliveredCount} delivered · {c.bouncedCount} bounced · {c.complainedCount} complaints</dd>
                    </>
                  )}
                  {c.resendBroadcastId && (
                    <>
                      <dt className="text-[var(--fg-faint)]">Broadcast</dt>
                      <dd className="text-[var(--fg)] break-all font-mono">{c.resendBroadcastId}</dd>
                    </>
                  )}
                </dl>
              </PortalSection>

              <PortalSection className={card}>
                <h2 className="text-sm font-bold text-[var(--fg)] mb-3">Audit trail</h2>
                {detail.audit.length === 0 ? (
                  <p className="text-xs text-[var(--fg-faint)]">No events yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {detail.audit.map((event) => (
                      <li key={event.id} className="border-l-2 border-gold/40 pl-3">
                        <p className="text-xs font-semibold text-[var(--fg)]">{ACTION_LABELS[event.action] ?? event.action}</p>
                        <p className="text-[11px] text-[var(--fg-faint)]">
                          {fmt(event.at)} · {event.actor}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </PortalSection>
            </aside>
          </div>
        </>
      )}
    </PortalPage>
  )
}
