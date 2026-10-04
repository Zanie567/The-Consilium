import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Exercise the actual shell boundary, without starting a server or touching a DB.
// npx represents an environment guard refusing a target. Every later command is
// a tripwire: executing even one means the launcher failed open.
describe('launchers fail closed before mutations', () => {
  for (const script of ['run-e2e.sh', 'run-audit.sh']) {
    it(`${script} propagates an environment-generator failure`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'consilium-launcher-'))
      const log = join(dir, 'commands')
      writeFileSync(log, '')
      for (const name of ['npx', 'node', 'psql', 'npm', 'lsof', 'curl']) {
        writeFileSync(join(dir, name), name === 'npx'
          ? '#!/bin/sh\necho "Refusing unsafe test environment" >&2\nexit 42\n'
          : '#!/bin/sh\necho "$0" >> "$LAUNCHER_TRIPWIRE"\nexit 43\n', { mode: 0o755 })
      }
      try {
        const result = spawnSync('/bin/bash', [resolve('scripts', script)], {
          env: { PATH: `${dir}:/usr/bin:/bin`, LAUNCHER_TRIPWIRE: log, NODE_ENV: 'test' },
          encoding: 'utf8', timeout: 10_000,
        })
        expect(result.status, result.stderr).not.toBe(0)
        expect(result.stderr).toContain('Refusing unsafe test environment')
        expect(readFileSync(log, 'utf8'), 'no build, SQL, server or cleanup after refusal').toBe('')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
