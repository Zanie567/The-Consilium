'use client'

import { useId, useState } from 'react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import { primaryButton, secondaryButton } from './NewsletterShell'

export interface PreferenceCentreProps {
  token: string
  maskedEmail: string
  status: 'PENDING' | 'ACTIVE' | 'UNSUBSCRIBED' | 'SUPPRESSED' | 'LEGACY'
  weeklyDigest: boolean
  specialAlerts: boolean
}

function Toggle({ id, label, description, checked, onChange, disabled }: { id: string; label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-[var(--border)] last:border-b-0">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-semibold text-[var(--fg)]">{label}</span>
        <span className="block text-xs text-[var(--fg-muted)] leading-relaxed mt-1">{description}</span>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer mt-1 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-[var(--border-strong)] transition-colors checked:bg-gold relative before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
      />
    </div>
  )
}

export function PreferenceCentre(props: PreferenceCentreProps) {
  const [status, setStatus] = useState(props.status)
  const [weekly, setWeekly] = useState(props.weeklyDigest)
  const [alerts, setAlerts] = useState(props.specialAlerts)
  const [saved, setSaved] = useState({ weekly: props.weeklyDigest, alerts: props.specialAlerts })
  const [busy, setBusy] = useState(false)
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const weeklyId = useId()
  const alertsId = useId()

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true)
    setNotice(null)
    try {
      return await apiRequest<{ status?: string; message?: string }>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: props.token, ...body }) })
    } catch (reason) {
      const error = asApiError(reason)
      setNotice({ kind: 'error', text: error.status === 400 ? 'This link has expired. Request a new one below.' : error.message || 'Something went wrong. Please try again.' })
      return null
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const result = await post('/api/newsletter/preferences', { weeklyDigest: weekly, specialAlerts: alerts })
    if (!result) return
    if (result.status === 'unsubscribed') {
      setStatus('UNSUBSCRIBED')
      setNotice({ kind: 'ok', text: 'You turned everything off, so you are now unsubscribed.' })
      return
    }
    setSaved({ weekly, alerts })
    setNotice({ kind: 'ok', text: result.status === 'unchanged' ? 'Nothing changed.' : 'Your preferences are saved.' })
  }

  async function unsubscribe() {
    const result = await post('/api/newsletter/unsubscribe', {})
    if (!result) return
    setStatus('UNSUBSCRIBED')
    setConfirmingUnsubscribe(false)
    setNotice({ kind: 'ok', text: 'You are unsubscribed. You will not receive any more newsletters from us.' })
  }

  async function reconfirm() {
    const result = await post('/api/newsletter/reconfirm', {})
    if (result) setNotice({ kind: 'ok', text: 'We have emailed you a confirmation link. Your subscription restarts only when you click it.' })
  }

  const dirty = weekly !== saved.weekly || alerts !== saved.alerts

  return (
    <div>
      <p className="text-xs text-[var(--fg-muted)] mb-2">
        Preferences for <span className="font-semibold text-[var(--fg)]">{props.maskedEmail}</span>
      </p>

      {status === 'ACTIVE' ? (
        <>
          <fieldset disabled={busy}>
            <legend className="sr-only">Newsletter topics</legend>
            <Toggle id={weeklyId} label="The Weekly Edition" description="Every Friday: the week's published articles, with summaries." checked={weekly} onChange={setWeekly} />
            <Toggle id={alertsId} label="Special-article alerts" description="Occasional, for pieces the editors judge exceptional. Never more than one a week." checked={alerts} onChange={setAlerts} />
          </fieldset>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={save} className={primaryButton} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save preferences'}
            </button>
            {!confirmingUnsubscribe ? (
              <button type="button" onClick={() => setConfirmingUnsubscribe(true)} className={secondaryButton} disabled={busy}>
                Unsubscribe from everything
              </button>
            ) : null}
          </div>
          {confirmingUnsubscribe ? (
            <div className="mt-5 border-l-2 border-gold pl-4" role="group" aria-label="Confirm unsubscribe">
              <p className="text-sm text-[var(--fg)] mb-3">Stop all newsletters from The Consilium to this address?</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={unsubscribe} className={primaryButton} disabled={busy}>
                  Yes, unsubscribe
                </button>
                <button type="button" onClick={() => setConfirmingUnsubscribe(false)} className={secondaryButton} disabled={busy}>
                  Keep my subscription
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : status === 'UNSUBSCRIBED' || status === 'LEGACY' ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--fg)] leading-relaxed">
            {status === 'UNSUBSCRIBED'
              ? 'This address is unsubscribed and receives nothing from us.'
              : 'This address signed up before we asked people to confirm, so we do not send to it. Confirm to start receiving the weekly edition.'}
          </p>
          <button type="button" onClick={reconfirm} className={secondaryButton} disabled={busy}>
            {status === 'UNSUBSCRIBED' ? 'Subscribe again' : 'Confirm my subscription'}
          </button>
          <p className="text-xs text-[var(--fg-faint)]">We will email a confirmation link first. Nothing changes until you click it.</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--fg)] leading-relaxed">
          {status === 'SUPPRESSED'
            ? 'We no longer send to this address because mail to it bounced or was reported as unwanted.'
            : 'This subscription has not been confirmed yet. Use the confirmation link we emailed you.'}
        </p>
      )}

      <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
        {notice ? (
          <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
            {notice.text}
          </p>
        ) : null}
      </div>
    </div>
  )
}
