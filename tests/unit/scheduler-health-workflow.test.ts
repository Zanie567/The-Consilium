/**
 * Executes the alert step of .github/workflows/scheduler-health.yml (the part that decides whether
 * GitHub emails you) against every shape of answer the endpoint can give. Same approach as
 * scheduled-workflow-guard.test.ts: the real shell script, with no network.
 *
 * The step reads /tmp/health.json (where the previous step saved the answer), so these cases run
 * one after another in a single test file and clean up after themselves.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const WORKFLOW = readFileSync(join(process.cwd(), '.github', 'workflows', 'scheduler-health.yml'), 'utf8')
const BODY_FILE = '/tmp/health.json'
const hasJq = spawnSync('jq', ['--version']).status === 0

/** The `run: |` script of the named step. */
function stepScript(name: string): string {
  const lines = WORKFLOW.split('\n')
  const start = lines.findIndex((l) => l.includes(`- name: ${name}`))
  expect(start, `step "${name}" exists`).toBeGreaterThan(-1)
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l))
  const body: string[] = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break
    body.push(line.slice(10))
  }
  return body.join('\n')
}

function alertStep(answer: string) {
  writeFileSync(BODY_FILE, answer)
  // GitHub runs `bash -e {0}`: replicate that, so a failing command anywhere fails the step.
  const r = spawnSync('bash', ['-e', '-c', stepScript('Fail only when the check raises an alert')], { encoding: 'utf8' })
  return { exit: r.status, out: `${r.stdout}${r.stderr}` }
}

const problem = (key: string, detail: string) => ({ key, detail })
const answer = (over: Record<string, unknown>) =>
  JSON.stringify({ checkedAt: '2026-10-08T12:00:00.000Z', ok: true, alert: false, recovered: false, problems: [], ...over })

afterAll(() => {
  if (existsSync(BODY_FILE)) rmSync(BODY_FILE)
})

describe.skipIf(!hasJq)('scheduler-health workflow: when does GitHub send an email?', () => {
  it('a healthy answer passes', () => {
    expect(alertStep(answer({})).exit).toBe(0)
  })

  it('a NEW problem fails the run (this is the email), naming each problem and its detail', () => {
    const r = alertStep(
      answer({ ok: false, alert: true, alertReason: 'new', problems: [problem('articles_overdue', '2 scheduled articles are overdue; the oldest by 40 minutes')] }),
    )
    expect(r.exit).toBe(1)
    expect(r.out).toContain('::error')
    expect(r.out).toContain('articles_overdue: 2 scheduled articles are overdue; the oldest by 40 minutes')
    expect(r.out).toContain('(new)')
  })

  it('several problems are all listed in the one alert', () => {
    const r = alertStep(
      answer({
        ok: false, alert: true, alertReason: 'changed',
        problems: [problem('scheduler_stopped', 'the last scheduler call was 90 minutes ago'), problem('requests_failing', 'the last 3 scheduler calls all failed (latest: auth_failure)')],
      }),
    )
    expect(r.exit).toBe(1)
    expect(r.out).toContain('scheduler_stopped')
    expect(r.out).toContain('requests_failing')
  })

  it('the 24-hour reminder fails the run again', () => {
    expect(alertStep(answer({ ok: false, alert: true, alertReason: 'reminder', problems: [problem('articles_overdue', 'x')] })).exit).toBe(1)
  })

  it('a problem that was ALREADY alerted passes, so a long outage is one email and not one per run', () => {
    const r = alertStep(answer({ ok: false, alert: false, problems: [problem('articles_overdue', 'x')] }))
    expect(r.exit).toBe(0)
    expect(r.out).toContain('already alerted')
  })

  it('a recovery passes and says so', () => {
    const r = alertStep(answer({ ok: true, alert: false, recovered: true }))
    expect(r.exit).toBe(0)
    expect(r.out).toContain('Recovered')
  })

  it('fails closed on an answer it cannot parse, rather than silently passing', () => {
    expect(alertStep('<html>maintenance</html>').exit).not.toBe(0)
    expect(alertStep('').exit).not.toBe(0)
  })

  it('fails closed on JSON that lacks the alert field', () => {
    expect(alertStep('{"ok":true}').exit).not.toBe(0)
  })
})

describe('scheduler-health workflow: static properties', () => {
  it('uses only the shared CRON_SECRET (never the publish-only secret), via env, against the canonical www host', () => {
    expect(WORKFLOW).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}')
    expect(WORKFLOW).not.toContain('PUBLISH_CRON_SECRET')
    expect(WORKFLOW).toContain('https://www.theconsilium.co.uk/api/cron/scheduler-health')
    expect(WORKFLOW).not.toMatch(/https:\/\/theconsilium\.co\.uk/)
  })

  it('does not call the publisher or the purge, and never edits other workflows', () => {
    expect(WORKFLOW).not.toContain('/api/publish-scheduled')
    expect(WORKFLOW).not.toContain('purge-trash')
    expect(WORKFLOW).not.toMatch(/gh workflow (disable|enable|run)/)
  })

  it('runs hourly: no more than 24 scheduled runs a day', () => {
    expect(WORKFLOW).toMatch(/- cron: '\d+ \* \* \* \*'/)
  })
})
