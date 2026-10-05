import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows')
const GUARD = "if: github.repository == 'Zanie567/The-Consilium'"

// The production schedules must keep their exact cadence.
const EXPECTED_CRONS: Record<string, string> = {
  'publish-scheduled.yml': '*/5 * * * *',
  'award-trophies.yml': '0 * * * *',
  'recalculate-streaks.yml': '0 2 * * *',
  'update-engagement-scores.yml': '0 3 * * *',
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

describe('scheduled production workflows', () => {
  const scheduled = workflows().filter(({ text }) => /^\s{2}schedule:/m.test(text))

  it('covers exactly the four production cron workflows', () => {
    expect(scheduled.map((w) => w.file).sort()).toEqual(Object.keys(EXPECTED_CRONS).sort())
  })

  it.each(scheduled)('$file runs every job only in the production repository', ({ text }) => {
    const jobs = jobBlocks(text)
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) expect(job).toContain(GUARD)
  })

  it.each(scheduled)('$file keeps its production cron cadence', ({ file, text }) => {
    expect(text).toContain(`- cron: '${EXPECTED_CRONS[file]}'`)
  })

  it.each(scheduled)('$file does not hide failures behind a successful exit', ({ text }) => {
    expect(text).toContain('exit 1')
    expect(text).not.toMatch(/continue-on-error|\|\|\s*true/)
  })
})
