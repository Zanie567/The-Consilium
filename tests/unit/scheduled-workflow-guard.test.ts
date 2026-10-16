import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows')
const PRODUCTION = 'Zanie567/The-Consilium'
const MIRROR = 'Zanie567/The-Consilium-Testing'
const GUARD = "if: github.repository == 'Zanie567/The-Consilium' && github.ref == 'refs/heads/main'"

// The production schedules must keep their exact cadence. Scheduled publishing is NOT here: Supabase Cron
// publishes every 5 minutes and publish-scheduled.yml is a manual-only fallback (tested below).
const EXPECTED_CRONS: Record<string, string> = {
  'award-trophies.yml': '0 * * * *',
  'recalculate-streaks.yml': '0 2 * * *',
  'update-engagement-scores.yml': '0 3 * * *',
  // Permanent trash removal, split out of publish-scheduled so publishing can never delete.
  'purge-trash.yml': '17 3 * * *',
  // Independent watchdog for scheduled publishing; alerts are de-duplicated by the endpoint.
  'scheduler-health.yml': '23 * * * *',
}

function workflows(): Array<{ file: string; text: string }> {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml'))
    .map((file) => ({ file, text: readFileSync(join(WORKFLOWS_DIR, file), 'utf8') }))
}

function jobBlocks(text: string): string[] {
  const body = text.split(/^jobs:\s*$/m)[1] ?? ''
  return body.split(/^  (?=[\w-]+:\s*$)/m).slice(1)
}

/** Evaluates a job's `if:` expression the way Actions would (only ==, && and string literals are used). */
function jobRuns(job: string, repository: string, ref: string): boolean {
  const expression = job.match(/^ {4}if: (.+)$/m)?.[1]
  if (!expression) return true // no condition: the job always runs
  const js = expression.replace(/github\.repository/g, 'repository').replace(/github\.ref/g, 'ref')
  if (!/^[\w\s=&'/.\-]+$/.test(js)) throw new Error(`Unsupported guard expression: ${expression}`)
  return new Function('repository', 'ref', `return ${js}`)(repository, ref) as boolean
}

/** The script of the job's first `run: |` step, with secret expressions replaced by dummies. */
function endpointScript(job: string): string {
  const lines = job.split('\n')
  const start = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l))
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break
    body.push(line.slice(10))
  }
  return body.join('\n').replace(/\$\{\{\s*secrets\.\w+\s*\}\}/g, 'dummy')
}

/** Runs the script with a stubbed curl that reports `status` and records its URL; never touches the network. */
function runWithStubbedCurl(script: string, status: number) {
  const dir = mkdtempSync(join(tmpdir(), 'cron-guard-'))
  const curl = join(dir, 'curl')
  writeFileSync(curl, `#!/bin/sh\nfor a; do last="$a"; done\necho "$last" >> "${dir}/urls"\nprintf '${status}'\n`)
  chmodSync(curl, 0o755)
  const result = spawnSync('bash', ['-c', script], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  return result.status
}

describe('scheduled production workflows', () => {
  const scheduled = workflows().filter(({ text }) => /^\s{2}schedule:/m.test(text))

  it('covers exactly the five production cron workflows', () => {
    expect(scheduled.map((w) => w.file).sort()).toEqual(Object.keys(EXPECTED_CRONS).sort())
  })

  it.each(scheduled)('$file guards every job on repository and main', ({ text }) => {
    const jobs = jobBlocks(text)
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) expect(job).toContain(GUARD)
  })

  it.each(scheduled)('$file runs on Production main', ({ text }) => {
    for (const job of jobBlocks(text)) expect(jobRuns(job, PRODUCTION, 'refs/heads/main')).toBe(true)
  })

  it.each(scheduled)('$file skips on a Production feature branch', ({ text }) => {
    for (const job of jobBlocks(text)) {
      expect(jobRuns(job, PRODUCTION, 'refs/heads/feat/public-appointments-testing-mode')).toBe(false)
    }
  })

  it.each(scheduled)('$file skips on the Testing mirror main', ({ text }) => {
    for (const job of jobBlocks(text)) expect(jobRuns(job, MIRROR, 'refs/heads/main')).toBe(false)
  })

  it.each(scheduled)('$file keeps its production cron cadence', ({ file, text }) => {
    expect(text).toContain(`- cron: '${EXPECTED_CRONS[file]}'`)
  })

  it.each(scheduled)('$file still fails on a non-200 endpoint and passes on 200', ({ text }) => {
    const script = endpointScript(jobBlocks(text)[0])
    expect(script).toContain('curl')
    for (const status of [401, 403, 500, 307]) expect(runWithStubbedCurl(script, status)).not.toBe(0)
    expect(runWithStubbedCurl(script, 200)).toBe(0)
    expect(text).not.toMatch(/continue-on-error|\|\|\s*true/)
  })
})

describe('publish-scheduled.yml (manual fallback publisher)', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'publish-scheduled.yml'), 'utf8')

  it('has no automatic schedule, so it can never run as a second automatic publisher', () => {
    expect(text).not.toMatch(/^\s*schedule:/m)
    expect(text).not.toMatch(/^\s*-\s*cron:/m)
  })

  it('keeps manual dispatch', () => {
    expect(text).toMatch(/^on:\s*\n(?:\s*#.*\n)*\s{2}workflow_dispatch:/m)
  })

  it('runs only on Production main', () => {
    const jobs = jobBlocks(text)
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) {
      expect(job).toContain(GUARD)
      expect(jobRuns(job, PRODUCTION, 'refs/heads/main')).toBe(true)
      expect(jobRuns(job, PRODUCTION, 'refs/heads/feat/public-appointments-testing-mode')).toBe(false)
      expect(jobRuns(job, MIRROR, 'refs/heads/main')).toBe(false)
    }
  })

  // The real step, run against a stub curl that answers with `status` and `body` and records its arguments.
  // The log of this public repository must never show what the endpoint returns about articles.
  const SECRET = 'test-cron-secret-0123456789abcdef0123456789abcdef'
  const TITLE = 'Unpublished Exclusive: Minister Resigns'
  const SLUG = 'unpublished-exclusive-minister-resigns'
  const ARTICLE_ID = 'cm9articleid000000000000'
  const EMAIL = 'author@example.org'
  const successBody = JSON.stringify({
    ranAt: '2026-10-16T15:00:00.000Z',
    due: 2,
    published: 1,
    articles: [{ id: ARTICLE_ID, title: TITLE, slug: SLUG }],
    skipped: [{ id: 'cm9skipped0000000000000', title: `${TITLE} (2)`, slug: `${SLUG}-2` }],
    warnings: [{ articleId: ARTICLE_ID, title: TITLE, stage: 'email', message: `Could not email ${EMAIL} about "${TITLE}"` }],
  })

  function runPublishStep(status: string, body: string) {
    const dir = mkdtempSync(join(tmpdir(), 'publish-step-'))
    writeFileSync(join(dir, 'body'), body)
    const curl = join(dir, 'curl')
    writeFileSync(
      curl,
      `#!/bin/sh\nout=""; prev=""\nfor a; do printf '%s\\n' "$a" >> "${dir}/args"; [ "$prev" = "--output" ] && out="$a"; prev="$a"; done\n` +
        `cat "${dir}/body" > "$out"\nprintf '%s' "${status}"\n`,
    )
    chmodSync(curl, 0o755)
    const result = spawnSync('bash', ['-e', '-c', endpointScript(jobBlocks(text)[0])], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CRON_SECRET: SECRET, SITE_URL: 'https://www.theconsilium.co.uk' },
      encoding: 'utf8',
    })
    const args = readFileSync(join(dir, 'args'), 'utf8').split('\n')
    return { code: result.status, log: `${result.stdout}${result.stderr}`, args }
  }

  function expectNothingSensitive(log: string) {
    for (const leak of [SECRET, TITLE, SLUG, ARTICLE_ID, EMAIL, 'Could not email', 'duplicate key', '<html']) {
      expect(log).not.toContain(leak)
    }
  }

  it('authenticates exactly as before: Bearer CRON_SECRET to the canonical publish endpoint', () => {
    const { args } = runPublishStep('200', successBody)
    expect(args).toContain(`Authorization: Bearer ${SECRET}`)
    expect(args).toContain('https://www.theconsilium.co.uk/api/publish-scheduled')
    expect(args).toContain('POST')
    // The secrets reach the script through env:, not by being written into its text.
    expect(text).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}')
    expect(text).toContain('SITE_URL: ${{ secrets.SITE_URL }}')
    expect(endpointScript(jobBlocks(text)[0])).not.toContain('secrets.')
  })

  it('on success logs counts and warning stages only, never titles, slugs, ids, messages or the secret', () => {
    const { code, log } = runPublishStep('200', successBody)
    expect(code).toBe(0)
    expect(log).toContain('HTTP status: 200')
    expect(log).toContain('Due: 2  Published: 1  Skipped: 1  Warnings: 1')
    expect(log).toContain('::warning title=Published with non-fatal warnings::stage(s): email.')
    expectNothingSensitive(log)
  })

  it('logs no warning annotation when there are no warnings, and never an unknown stage name', () => {
    const quiet = runPublishStep('200', JSON.stringify({ due: 0, published: 0, articles: [], skipped: [], warnings: [] }))
    expect(quiet.code).toBe(0)
    expect(quiet.log).toContain('Due: 0  Published: 0  Skipped: 0  Warnings: 0')
    expect(quiet.log).not.toContain('::warning')
    const odd = runPublishStep('200', JSON.stringify({ due: 1, published: 1, warnings: [{ stage: TITLE, message: EMAIL }] }))
    expect(odd.code).toBe(0)
    expect(odd.log).toContain('Warnings: 1')
    expectNothingSensitive(odd.log)
  })

  it('fails on any non-200 answer without printing the error body', () => {
    const errorBody = JSON.stringify({ error: `duplicate key value violates "${TITLE}" for ${EMAIL}` })
    for (const status of ['401', '403', '404', '500', '503', '307', '000', '']) {
      const { code, log } = runPublishStep(status, errorBody)
      expect(code).not.toBe(0)
      expect(log).toContain('::error title=Publish endpoint failed::')
      expectNothingSensitive(log)
    }
  })

  it('fails closed on a 200 that is not the endpoint JSON (firewall or maintenance page)', () => {
    for (const body of ['<html><body>Maintenance</body></html>', '', '{}', '{"due":"2","published":1}', 'null']) {
      const { code, log } = runPublishStep('200', body)
      expect(code).not.toBe(0)
      expect(log).toContain('::error title=Publish endpoint gave an unreadable answer::')
      expectNothingSensitive(log)
    }
  })

  it('never prints the response body and never swallows a failure', () => {
    expect(text).not.toMatch(/Response body|cat "\$BODY_FILE"|cat \/tmp/)
    expect(text).not.toMatch(/continue-on-error|\|\|\s*true/)
  })
})
