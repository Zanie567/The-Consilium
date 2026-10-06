import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Exercise the actual shell boundary, without starting a server or touching a DB.
// npx represents an environment guard refusing a target. Every later command is
// a tripwire: executing even one means the launcher failed open.
describe('launchers fail closed before mutations', () => {
  it('standalone attestation rejects unsafe ownership before HTTP or SQL', () => {
    const result = spawnSync(process.execPath, ['scripts/attest-test-run.mjs'], {
      env: { ...process.env, TEST_DATABASE_URL: 'postgresql://postgres@production.invalid/consilium', DATABASE_URL: 'postgresql://postgres@production.invalid/consilium', DIRECT_URL: 'postgresql://postgres@production.invalid/consilium', E2E_RUN_ID: 'next-e2e-3200-1234' },
      encoding: 'utf8', timeout: 10_000,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing')
    expect(result.stderr).not.toMatch(/ENOTFOUND|ECONNREFUSED|fetch failed/)
  })
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

describe('resource refusals precede database and service work',()=>{
 for(const extra of [{SKIP_BUILD:'1'},{AUDIT_BASE_URL:'http://localhost:3200'},{OCCUPIED:'1'}]){
  it(`refuses ${Object.keys(extra)[0]} before SQL, build or startup`,()=>{
   const dir=mkdtempSync(join(tmpdir(),'consilium-resource-guard-'));const log=join(dir,'commands');writeFileSync(log,'')
   writeFileSync(join(dir,'npx'),`#!/bin/sh\necho "export NEXTAUTH_URL='http://localhost:3200' NEXT_PUBLIC_SUPABASE_URL='http://localhost:54321' TEST_DATABASE_URL='postgresql://postgres@localhost:5433/postgres'"\n`,{mode:0o755})
   writeFileSync(join(dir,'lsof'),'#!/bin/sh\n[ "$OCCUPIED" = 1 ]\n',{mode:0o755})
   for(const name of ['node','psql','npm','curl','initdb','pg_ctl'])writeFileSync(join(dir,name),'#!/bin/sh\necho "'+name+'" >> "$LAUNCHER_TRIPWIRE"\nexit 43\n',{mode:0o755})
   try{const result=spawnSync('/bin/bash',[resolve('scripts/run-e2e.sh')],{env:{NODE_ENV:'test',PATH:`${dir}:/usr/bin:/bin`,LAUNCHER_TRIPWIRE:log,...extra},encoding:'utf8',timeout:10000});expect(result.status).not.toBe(0);expect(readFileSync(log,'utf8')).not.toMatch(/psql|npm|curl|initdb|pg_ctl/)}finally{rmSync(dir,{recursive:true,force:true})}
  })
 }
 it('fixture setup rejects a failed URL guard before cluster startup or SQL',()=>{
  const dir=mkdtempSync(join(tmpdir(),'consilium-fixture-guard-'));const log=join(dir,'commands');writeFileSync(log,'')
  writeFileSync(join(dir,'npx'),'#!/bin/sh\necho "Refusing unsafe test environment" >&2\nexit 42\n',{mode:0o755})
  for(const name of ['psql','npm','pg_isready','initdb','pg_ctl','createdb'])writeFileSync(join(dir,name),'#!/bin/sh\necho "$0" >> "$LAUNCHER_TRIPWIRE"\nexit 43\n',{mode:0o755})
  try{const result=spawnSync('/bin/bash',[resolve('scripts/setup-test-db.sh')],{env:{NODE_ENV:'test',PATH:`${dir}:/usr/bin:/bin`,PGBIN:dir,USE_EXISTING_DB:'1',TEST_DATABASE_URL:'postgresql://production.invalid/db',LAUNCHER_TRIPWIRE:log},encoding:'utf8',timeout:10000});expect(result.status).not.toBe(0);expect(readFileSync(log,'utf8')).toBe('')}finally{rmSync(dir,{recursive:true,force:true})}
 })
})
