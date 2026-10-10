/**
 * The decision logic of the independent scheduler health check: given a snapshot of the evidence,
 * which problems exist? Pure, table-driven. The database collection and the alert de-duplication
 * are covered against a real database in tests/integration/scheduler-end-to-end.test.ts.
 *
 * Output goes to a PUBLIC repository's Actions logs, so details must be counts and ages only.
 */
import { describe, it, expect } from 'vitest'
import { evaluateHealth, THRESHOLDS, type Snapshot, type Invocation } from '@/lib/schedulerHealth'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

const run = (outcome: string, ageMinutes: number, warningCount: number | null = null): Invocation => ({
  outcome,
  invokedAt: minutesAgo(ageMinutes),
  warningCount: outcome === 'success' ? (warningCount ?? 0) : null,
})

/** Healthy: nothing overdue, the Supabase job is active and ran 2 minutes ago, 12 clean runs. */
function snapshot(over: { overdue?: Snapshot['overdue']; supabase?: Partial<Snapshot['supabase']> } = {}): Snapshot {
  return {
    now: NOW,
    overdue: over.overdue ?? { count: 0, oldestScheduledAt: null },
    supabase: {
      state: 'active',
      lastInvokedAt: minutesAgo(2),
      recent: Array.from({ length: 12 }, (_, i) => run('success', 2 + i * 5)),
      warningRuns24h: 0,
      ...over.supabase,
    },
  }
}
const keys = (s: Snapshot) => evaluateHealth(s).map((p) => p.key)

describe('a healthy system reports nothing', () => {
  it('no overdue article, an active job that ran recently, clean runs', () => {
    expect(evaluateHealth(snapshot())).toEqual([])
  })

  it.each(['not_installed', 'not_scheduled', 'job_inactive'] as const)(
    'before activation or after a rollback (%s) the Supabase scheduler is not expected to run, so its silence is not a problem',
    (state) => {
      expect(keys(snapshot({ supabase: { state, lastInvokedAt: minutesAgo(5000), recent: [] } }))).toEqual([])
    },
  )
})

describe('articles that stay unpublished past their time', () => {
  const overdue = (count: number, ageMinutes: number) => ({ count, oldestScheduledAt: minutesAgo(ageMinutes) })

  it('flags them with a count and an age, and never a title or id', () => {
    const problems = evaluateHealth(snapshot({ overdue: overdue(2, 40) }))
    expect(problems).toHaveLength(1)
    expect(problems[0].key).toBe('articles_overdue')
    expect(problems[0].detail).toBe('2 scheduled articles are overdue; the oldest by 40 minutes')
  })

  it('uses the singular for one article', () => {
    expect(evaluateHealth(snapshot({ overdue: overdue(1, 20) }))[0].detail).toBe('1 scheduled article is overdue; the oldest by 20 minutes')
  })

  it('works whichever scheduler is in charge (a GitHub-only system is covered too)', () => {
    expect(keys(snapshot({ overdue: overdue(1, 60), supabase: { state: 'not_installed', lastInvokedAt: null, recent: [] } }))).toEqual(['articles_overdue'])
  })
})

describe('a scheduler that has stopped running', () => {
  it(`is flagged when the active job's last call is older than ${THRESHOLDS.staleMinutes} minutes`, () => {
    const s = snapshot({ supabase: { lastInvokedAt: minutesAgo(THRESHOLDS.staleMinutes + 1) } })
    expect(keys(s)).toEqual(['scheduler_stopped'])
    expect(evaluateHealth(s)[0].detail).toBe(`the last scheduler call was ${THRESHOLDS.staleMinutes + 1} minutes ago`)
  })

  it('is not flagged exactly at the threshold, nor for a normal gap', () => {
    expect(keys(snapshot({ supabase: { lastInvokedAt: minutesAgo(THRESHOLDS.staleMinutes) } }))).toEqual([])
    expect(keys(snapshot({ supabase: { lastInvokedAt: minutesAgo(6) } }))).toEqual([])
  })

  it('is flagged when an active job has never made a call at all', () => {
    const s = snapshot({ supabase: { lastInvokedAt: null, recent: [] } })
    expect(keys(s)).toEqual(['scheduler_stopped'])
    expect(evaluateHealth(s)[0].detail).toBe('the scheduler job is active but has recorded no calls')
  })
})

describe('failed or missing HTTP requests', () => {
  const FAILS = ['auth_failure', 'http_error', 'timeout', 'network_error', 'lost', 'not_sent', 'bad_response']

  it.each(FAILS)(`${THRESHOLDS.failureStreak} consecutive %s results are flagged`, (outcome) => {
    const recent = [run(outcome, 2), run(outcome, 7), run(outcome, 12), run('success', 17)]
    expect(keys(snapshot({ supabase: { recent } }))).toEqual(['requests_failing'])
  })

  it('a mix of different failures still counts as a streak', () => {
    const recent = [run('timeout', 2), run('auth_failure', 7), run('lost', 12), run('success', 17)]
    expect(keys(snapshot({ supabase: { recent } }))).toEqual(['requests_failing'])
  })

  it('one or two failures, or failures separated by a success, are not flagged (no alert for a blip)', () => {
    expect(keys(snapshot({ supabase: { recent: [run('http_error', 2), run('http_error', 7), run('success', 12)] } }))).toEqual([])
    expect(keys(snapshot({ supabase: { recent: [run('http_error', 2), run('success', 7), run('http_error', 12), run('http_error', 17)] } }))).toEqual([])
  })

  it('needs enough history to judge: fewer runs than the streak length never flag', () => {
    expect(keys(snapshot({ supabase: { recent: [run('http_error', 2), run('http_error', 7)] } }))).toEqual([])
  })

  it('reports how many calls failed in a row, without any response body', () => {
    const recent = [run('http_error', 2), run('http_error', 7), run('http_error', 12), run('http_error', 17), run('success', 22)]
    expect(evaluateHealth(snapshot({ supabase: { recent } }))[0].detail).toBe('the last 4 scheduler calls all failed (latest: http_error)')
  })
})

describe('repeated non-fatal publication warnings', () => {
  it(`flags ${THRESHOLDS.warningRuns} or more runs with warnings in ${THRESHOLDS.warningWindowHours} hours`, () => {
    const s = snapshot({ supabase: { warningRuns24h: THRESHOLDS.warningRuns } })
    expect(keys(s)).toEqual(['repeated_warnings'])
    expect(evaluateHealth(s)[0].detail).toBe(`${THRESHOLDS.warningRuns} publishing runs had warnings in the last ${THRESHOLDS.warningWindowHours} hours`)
  })

  it('a single run with a warning is not an alert', () => {
    expect(keys(snapshot({ supabase: { warningRuns24h: 1 } }))).toEqual([])
  })
})

describe('the monitor itself', () => {
  it('flags a blind spot when the scheduler records cannot be read (so a broken check is not mistaken for a healthy system)', () => {
    const s = snapshot({ supabase: { state: 'unreadable', lastInvokedAt: null, recent: [] } })
    expect(keys(s)).toEqual(['monitoring_blind'])
  })
})

describe('combined problems', () => {
  it('are all reported, in a stable order', () => {
    const s = snapshot({
      overdue: { count: 3, oldestScheduledAt: minutesAgo(90) },
      supabase: {
        lastInvokedAt: minutesAgo(60),
        recent: [run('http_error', 60), run('http_error', 65), run('http_error', 70)],
        warningRuns24h: 4,
      },
    })
    expect(keys(s)).toEqual(['articles_overdue', 'scheduler_stopped', 'requests_failing', 'repeated_warnings'])
  })

  it('never put an article title, id, URL, header or secret in any detail line', () => {
    const s = snapshot({
      overdue: { count: 3, oldestScheduledAt: minutesAgo(90) },
      supabase: { lastInvokedAt: minutesAgo(60), recent: [run('auth_failure', 60), run('auth_failure', 65), run('auth_failure', 70)], warningRuns24h: 4 },
    })
    for (const p of evaluateHealth(s)) expect(p.detail).toMatch(/^[A-Za-z0-9 ;():_,.-]+$/)
  })
})
