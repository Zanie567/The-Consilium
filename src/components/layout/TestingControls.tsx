'use client'
import { useState, useEffect, useRef } from 'react'
import type { Session } from 'next-auth'
import { getTestingTabId, isTestingTransition, setTestingTransition } from '@/lib/testingClient'
import { TEST_PERSONA_LABELS } from '@/lib/testingLabels'
import { buildNav } from '@/lib/adminNav'

export function TestingControls({ banner = false, testing, ordinaryRole }: { banner?: boolean; testing?: Session['testing']; ordinaryRole?: string }) {
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  // Formatted in the browser only: the server's time zone and locale differ, which would be a hydration mismatch.
  const [endsAt, setEndsAt] = useState('')
  useEffect(() => {
    if (testing) setEndsAt(new Date(testing.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  }, [testing])
  useEffect(() => {
    setReady(true)
    // A history-restored document can retain the state from the successful POST
    // that navigated away. Re-enable controls; the server still verifies identity.
    const restore = () => { setTestingTransition(false); setBusy(false) }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) restore() }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('popstate', restore)
    return () => { window.removeEventListener('pageshow', onPageShow); window.removeEventListener('popstate', restore) }
  }, [])
  const bannerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!banner || !bannerRef.current) return
    let frame = 0
    // Apply layout changes in the next frame, outside observer delivery. WebKit
    // otherwise reports a ResizeObserver loop when editor layout changes resize it.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const height = `${bannerRef.current?.offsetHeight ?? 0}px`
        if (document.documentElement.style.getPropertyValue('--testing-banner-height') !== height) document.documentElement.style.setProperty('--testing-banner-height', height)
      })
    })
    observer.observe(bannerRef.current)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.documentElement.style.removeProperty('--testing-banner-height') }
  }, [banner])
  useEffect(() => {
    if (!testing) return
    const timer = setTimeout(() => window.location.assign('/editorial'), Math.max(0, Date.parse(testing.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [testing])
  async function change(persona?: string) {
    if (!ready || isTestingTransition()) return
    setTestingTransition(true)
    setBusy(true)
    setError('')
    try {
    const result = await fetch('/api/testing-session', { method: persona ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, ...(persona ? { body: JSON.stringify({ persona }) } : {}) })
    if (!result.ok) { setError((await result.json()).error); setTestingTransition(false); setBusy(false); return }
    const channel = new BroadcastChannel('consilium-testing')
    channel.postMessage({ source: getTestingTabId() })
    channel.close()
    window.location.assign('/editorial')
    } catch {
      setError('Testing mode could not be changed. Try again.')
      setTestingTransition(false)
      setBusy(false)
    }
  }
  if (!banner) {
    const PERSONA_CARDS = [
      { persona: 'writer', role: 'WRITER', blurb: 'Writes and submits articles, and edits their own team profile.' },
      { persona: 'editor', role: 'EDITOR', blurb: 'Reviews submissions in an assigned category (Opinion) and manages debates.' },
      { persona: 'growth', role: 'GROWTH', blurb: 'Follows audience, subscribers and engagement.' },
    ] as const
    const OTHERS = ['writer-other', 'editor-global'] as const
    return <div ref={bannerRef} className="space-y-4">
      {testing && <p role="status" className="border-l-2 border-gold pl-3 text-sm">
        Testing as <strong>{TEST_PERSONA_LABELS[testing.persona]}</strong>. This session ends{' '}
        {endsAt ? <>at <time dateTime={testing.expiresAt}>{endsAt}</time></> : 'within 15 minutes'}{' '}
        and then returns you to the administrator view.
      </p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {PERSONA_CARDS.map(({ persona, role, blurb }) => {
          const menu = buildNav({ role }).flatMap((g) => g.items).map((i) => i.label)
          const active = testing?.persona === persona
          return <div key={persona} className={`border p-4 ${active ? 'border-gold' : 'border-[var(--border)]'}`} aria-current={active ? 'true' : undefined}>
            <h3 className="text-sm font-bold uppercase tracking-widest">{TEST_PERSONA_LABELS[persona]}{active && <span className="ml-2 text-gold">· active</span>}</h3>
            <p className="mt-1 text-sm opacity-80">{blurb}</p>
            <p className="mt-2 text-xs opacity-70">Should see in the menu: {menu.join(', ')}</p>
            <button disabled={!ready || busy} className="mt-3 underline p-1 disabled:opacity-50" onClick={() => change(persona)}>Test as {TEST_PERSONA_LABELS[persona]}</button>
          </div>
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="opacity-70">Boundary checks:</span>
        {OTHERS.map((persona) => <button key={persona} disabled={!ready || busy} className="underline p-1 disabled:opacity-50" onClick={() => change(persona)}>Test as {TEST_PERSONA_LABELS[persona]}</button>)}
        {testing && <button disabled={!ready || busy} className="underline p-1 disabled:opacity-50" onClick={() => change()}>Exit testing mode</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  }
    return <div ref={bannerRef} className={banner ? 'fixed top-0 inset-x-0 z-[300] border-b border-gold bg-navy text-cream px-4 py-2 text-sm' : 'space-y-3'} role={banner ? 'region' : undefined} aria-label={banner ? 'Testing environment' : undefined}>
    {banner && <strong>TEST ENVIRONMENT · {testing ? TEST_PERSONA_LABELS[testing.persona] : ordinaryRole === 'ADMIN' ? 'Administrator' : ordinaryRole ? `${ordinaryRole.charAt(0)}${ordinaryRole.slice(1).toLowerCase()} (ordinary login)` : 'Signed out'} </strong>}
    {(!banner || testing || ordinaryRole === 'ADMIN') && <div className="inline-flex flex-wrap gap-3">
      {(['writer', 'editor', 'growth', 'writer-other', 'editor-global'] as const).map((persona) => <button key={persona} disabled={!ready || busy} className="underline p-1 disabled:opacity-50" onClick={() => change(persona)}>Test as {TEST_PERSONA_LABELS[persona]}</button>)}
      {testing && <button disabled={!ready || busy} className="underline p-1 disabled:opacity-50" onClick={() => change()}>Exit testing mode</button>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>
}
