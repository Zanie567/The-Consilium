'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from 'next-auth'
import { SCENARIOS, scenariosFor, type ScenarioId } from '@/lib/testingScenarioCatalog'
import { probesFor, judgeProbe, type Probe } from '@/lib/testingAccessProbes'
import { TEST_PERSONA_LABELS } from '@/lib/testingLabels'
import type { ScenarioState } from '@/lib/testingScenarios'

type Persona = keyof typeof TEST_PERSONA_LABELS
const PERSONAS = Object.keys(TEST_PERSONA_LABELS) as Persona[]

const button = 'inline-flex min-h-[36px] items-center border px-3 text-xs font-bold uppercase tracking-widest disabled:opacity-50 border-[var(--border-strong)] hover:border-gold'

function appliedLabel(id: ScenarioId, state: ScenarioState | null): string | null {
  if (!state) return null
  switch (id) {
    case 'newly-registered':
    case 'no-linked-profile': return state.profile === 'removed' ? 'Applied' : null
    case 'completed-profile': return state.profile === 'completed' ? 'Applied' : null
    case 'writer-draft': return state.draft ? 'Applied' : null
    case 'writer-submitted': return state.submitted ? 'Applied' : null
    case 'editor-queue': return state.queue ? 'Applied' : null
    case 'unread-notifications': return state.notifications === 'unread' ? 'Applied' : null
    case 'dismissed-notifications': return state.notifications === 'read' ? 'Applied' : null
    case 'first-publish': return state.firstPublish ? 'Applied' : null
    default: return null
  }
}

interface Row { probe: Probe; pass: boolean; detail: string }

/**
 * Test scenarios and the access check. Everything here talks to endpoints that refuse to act
 * unless the workspace is a verified isolated one, and only ever addresses the five test personas.
 */
export function TestingScenarios({ testing }: { testing?: Session['testing'] }) {
  const [persona, setPersona] = useState<Persona>((testing?.persona as Persona) ?? 'writer')
  const [state, setState] = useState<ScenarioState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [checking, setChecking] = useState(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async (p: Persona) => {
    try {
      const res = await fetch(`/api/testing-scenarios?persona=${p}`, { cache: 'no-store' })
      const body = (await res.json()) as { state?: ScenarioState | null }
      setState(res.ok ? body.state ?? null : null)
    } catch { setState(null) }
  }, [])
  useEffect(() => { void refresh(persona) }, [persona, refresh])

  async function post(payload: Record<string, unknown>, done: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/testing-scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'The scenario could not be applied.')
      setMessage({ ok: true, text: done })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The scenario could not be applied.' })
    } finally {
      await refresh(persona)
      inFlight.current = false
      setBusy(false)
    }
  }

  async function checkAccess() {
    if (!testing || checking) return
    setChecking(true)
    setRows(null)
    const results: Row[] = []
    for (const probe of probesFor(testing.persona)) {
      try {
        const res = await fetch(probe.url, { cache: 'no-store', headers: probe.kind === 'api' ? { Accept: 'application/json' } : undefined })
        const bodyText = probe.kind === 'page' ? (await res.text()).slice(0, 4000) : ''
        if (probe.kind === 'api') await res.arrayBuffer()
        const judged = judgeProbe(probe, { status: res.status, finalPath: new URL(res.url).pathname, bodyText })
        results.push({ probe, ...judged })
      } catch {
        results.push({ probe, pass: false, detail: 'the request failed' })
      }
    }
    setRows(results)
    setChecking(false)
  }

  const applicable = scenariosFor(persona)
  const failed = rows?.filter((r) => !r.pass) ?? []

  return (
    <div className="space-y-8">
      <section aria-labelledby="scenarios-heading" className="space-y-3">
        <h2 id="scenarios-heading" className="text-lg font-bold">Scenarios</h2>
        <p className="text-sm opacity-80">
          Put a test persona into a known situation, then use “Test as …” to see what they actually get. Scenarios only change the five
          test accounts, can be applied again safely, and “Reset” puts the persona back exactly as it was.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="scenario-persona" className="block text-xs uppercase tracking-widest opacity-70">Persona</label>
            <select id="scenario-persona" value={persona} onChange={(e) => setPersona(e.target.value as Persona)} className="min-h-[36px] border border-[var(--border)] bg-[var(--bg)] px-2 text-sm">
              {PERSONAS.map((p) => <option key={p} value={p}>{TEST_PERSONA_LABELS[p]}</option>)}
            </select>
          </div>
          <button type="button" disabled={busy} className={button} onClick={() => void post({ action: 'reset', persona }, `${TEST_PERSONA_LABELS[persona]} reset.`)}>Reset {TEST_PERSONA_LABELS[persona]}</button>
          <button type="button" disabled={busy} className={button} onClick={() => void post({ action: 'reset' }, 'Every test persona reset.')}>Reset all personas</button>
        </div>
        <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${message ? (message.ok ? 'text-emerald-600' : 'text-red-500') : ''}`}>{message?.text}</p>

        <ul className="divide-y divide-[var(--border)] border border-[var(--border)]">
          {applicable.map((s) => {
            const applied = appliedLabel(s.id, state)
            return (
              <li key={s.id} data-testid={`scenario-${s.id}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[240px] flex-1">
                    <p className="font-semibold">{s.label}{applied && <span className="ml-2 text-xs font-bold uppercase tracking-widest text-emerald-600">{applied}</span>}</p>
                    <p className="mt-0.5 text-sm opacity-80">{s.description}</p>
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {s.expectations(persona).map((e) => (
                        <li key={e.what} className="flex gap-2">
                          <span aria-hidden className={e.shouldShow ? 'text-emerald-600' : 'text-red-500'}>{e.shouldShow ? '✓' : '✗'}</span>
                          <span><span className="sr-only">{e.shouldShow ? 'Should show: ' : 'Should not show: '}</span>{e.what} <span className="opacity-60">({e.where})</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {s.id !== 'restricted-access' && (
                    <button type="button" disabled={busy} className={button} onClick={() => void post({ action: 'apply', persona, scenario: s.id }, `“${s.label}” applied to ${TEST_PERSONA_LABELS[persona]}.`)}>Apply</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="text-xs opacity-60">{SCENARIOS.length} scenarios in the catalogue. A ✓ means it must be there, a ✗ means it must not be.</p>
      </section>

      <section aria-labelledby="access-heading" className="space-y-3">
        <h2 id="access-heading" className="text-lg font-bold">Check access</h2>
        <p className="text-sm opacity-80">
          Opens this persona’s pages and tries administrator-only pages and APIs, as the persona, against the real server. Start a test
          session first.
        </p>
        <button type="button" className={button} disabled={!testing || checking} onClick={() => void checkAccess()}>
          {checking ? 'Checking…' : testing ? `Check access as ${TEST_PERSONA_LABELS[testing.persona]}` : 'Start a test session to check access'}
        </button>
        {rows && (
          <div data-testid="access-results">
            <p role="status" className={`text-sm font-bold ${failed.length === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {failed.length === 0 ? `All ${rows.length} checks behaved as expected.` : `${failed.length} of ${rows.length} checks did not behave as expected.`}
            </p>
            <table className="mt-2 w-full text-left text-xs">
              <caption className="sr-only">Access check results</caption>
              <thead><tr className="uppercase tracking-widest opacity-70"><th scope="col" className="py-1">Result</th><th scope="col">Expected</th><th scope="col">What was tried</th><th scope="col">Outcome</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.probe.url} className="border-t border-[var(--border)]">
                    <td className={`py-1 font-bold ${r.pass ? 'text-emerald-600' : 'text-red-500'}`}>{r.pass ? 'Pass' : 'FAIL'}</td>
                    <td>{r.probe.expect === 'allowed' ? 'opens' : 'refused'}</td>
                    <td>{r.probe.label}</td>
                    <td>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
