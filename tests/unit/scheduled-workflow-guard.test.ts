import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows')
const PRODUCTION = 'Zanie567/The-Consilium'
const MIRROR = 'Zanie567/The-Consilium-Testing'
const GUARD = "if: github.repository == 'Zanie567/The-Consilium' && github.ref == 'refs/heads/main'"

// The production schedules must keep their exact cadence.
const EXPECTED_CRONS: Record<string, string> = {
  'publish-scheduled.yml': '*/5 * * * *',
  'award-trophies.yml': '0 * * * *',
  'recalculate-streaks.yml': '0 2 * * *',
  'update-engagement-scores.yml': '0 3 * * *',
  // Permanent trash removal, split out of publish-scheduled so publishing can never delete.
  'purge-trash.yml': '17 3 * * *',
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
