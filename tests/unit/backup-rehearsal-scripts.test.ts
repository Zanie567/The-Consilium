/**
 * Refusals of the two rehearsal scripts (issue #129). They are exercised end to end against disposable containers
 * (see docs/remediation/backup-and-verify.md and docs/remediation/migration-registry.md); these tests pin the guards
 * that must hold without Docker or a database: no hosted database, no overwritten evidence, no half-specified run.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REHEARSE_RESTORE = join(process.cwd(), 'scripts/backup/restore-rehearsal.sh')
const REHEARSE_REGISTRY = join(process.cwd(), 'scripts/db/rehearse-migration-registry.sh')
const run = (script: string, args: string[]) => spawnSync('/bin/bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } })

const dirs: string[] = []
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'rehearsal-test-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('restore-rehearsal.sh', () => {
  it('needs a backup folder and an evidence folder', () => {
    expect(run(REHEARSE_RESTORE, []).status).toBe(2)
    expect(run(REHEARSE_RESTORE, [temp()]).status).toBe(2)
  })

  it('refuses a folder that is not a backup', () => {
    const r = run(REHEARSE_RESTORE, [temp(), '--evidence', join(temp(), 'e')])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('not a backup folder')
  })

  it('never overwrites earlier evidence', () => {
    const backup = temp()
    writeFileSync(join(backup, 'schema.sql'), '-- schema')
    writeFileSync(join(backup, 'data.sql'), '-- data')
    const evidence = join(temp(), 'e')
    mkdirSync(evidence)
    writeFileSync(join(evidence, 'summary.txt'), 'earlier run')
    const r = run(REHEARSE_RESTORE, [backup, '--evidence', evidence])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('refusing to overwrite')
  })

  // 2026-10-25: production keeps the scheduler's table and SECURITY DEFINER functions owner-only (no service_role).
  // pg_dump writes no REVOKE for that, so the image's own default privileges re-granted service_role on restore and
  // the security fingerprint differed (table_grants 688 vs 680, function_execute_grants 25 vs 23).
  it('revokes the image default privileges for every API role before loading the schema', () => {
    const script = readFileSync(REHEARSE_RESTORE, 'utf8')
    const schemaLoad = script.indexOf('cat "$BACKUP/schema.sql"')
    for (const kind of ['TABLES', 'FUNCTIONS']) {
      const revoke = script.indexOf(`IN SCHEMA public REVOKE ALL ON ${kind} FROM anon, authenticated, service_role;`)
      expect(revoke, `${kind} defaults revoked for anon, authenticated and service_role`).toBeGreaterThan(-1)
      expect(revoke).toBeLessThan(schemaLoad)
    }
  })
})

describe('rehearse-migration-registry.sh', () => {
  it.each([
    'postgresql://postgres:x@db.scllbuwkcqtmfogsgalt.supabase.co:5432/postgres',
    'postgresql://postgres.ref:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:x@10.0.0.5:5432/postgres',
  ])('refuses a database that is not local: %s', (url) => {
    const r = run(REHEARSE_REGISTRY, [url])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('only a local disposable server')
  })

  it('needs a server URL', () => {
    expect(run(REHEARSE_REGISTRY, []).status).toBe(2)
  })
})
