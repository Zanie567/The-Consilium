import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('shell harness refuses a failed database resolver before build/server/setup', () => {
  it.each(['scripts/run-audit.sh', 'scripts/run-team-profile-e2e.sh'])('%s fails closed', (script) => {
    const directory = mkdtempSync(join(tmpdir(), 'consilium-db-entry-'))
    directories.push(directory)
    const marker = join(directory, 'unsafe-child-started')
    // Model a refused database with no export output. eval "$(...)" used to
    // mask this nonzero status by successfully evaluating the empty string.
    writeFileSync(join(directory, 'npx'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(directory, 'npm'), '#!/bin/sh\ntouch "$ENTRYPOINT_TEST_MARKER"\nexit 99\n', { mode: 0o755 })
    const result = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 5000,
      env: {
        ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}`,
        ENTRYPOINT_TEST_MARKER: marker, SKIP_DB_SETUP: '0', SKIP_BUILD: '0',
      },
    })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/refusing.*(?:unsafe|isolated)/)
    expect(existsSync(marker)).toBe(false)
  })
})
