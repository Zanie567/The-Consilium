/**
 * The backup toolkit (scripts/backup/*): run for real, under /bin/bash (the 3.2 that ships with macOS), with stand-in
 * `supabase` and `docker` programs on PATH. No network, no database, no Docker.
 *
 * What is proven: the credential handling (nothing secret on screen, in a file or in the manifest), the refusals
 * (wrong project, wrong host, unsafe folder), and that the verifier fails on every kind of bad backup.
 * What these tests do not prove: Docker, a real database, or the real production dump contents. The flag contract with
 * the installed Supabase CLI is checked below with `--dry-run`; the whole chain (real CLI, real dump, verifier,
 * restore) is exercised by scripts/backup/local-integration-test.sh, and production by the operator with the verifier.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const TAKE = join(ROOT, 'scripts/backup/take-supabase-backup.sh')
const VERIFY = join(ROOT, 'scripts/backup/verify-supabase-backup.sh')

const TABLES = 'accounts admin_notes article_notes article_tags article_views articles ArticleTrophy audit_logs bookmarks categories category_editors comment_upvotes comments contact_messages debate_votes debates glossary_terms login_attempts notifications password_reset_tokens prediction_events predictions reading_progress series sessions site_settings site_views subscribers tags team_members team_memberships testing_sessions user_warnings users verification_tokens writer_achievements writer_streaks'.split(' ')
const REF = 'projectrefprojectref'
const SECRET = 'S3cr3t%40P-ss.W0rd' // percent-encoded, as the CLI requires
const SECRET_DECODED = 'S3cr3t@P-ss.W0rd'
const GOOD_URL = `postgresql://postgres.${REF}:${SECRET}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`

let work: string
const dirs: string[] = []
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'backup-test-'))
  dirs.push(work)
})
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// ── stand-ins ────────────────────────────────────────────────────────────────────────────────────────────
function shims(options: { failDump?: boolean; echoUrlOnFailure?: boolean; emptyData?: boolean } = {}) {
  const bin = join(work, 'bin')
  mkdirSync(bin)
  const log = join(work, 'shim-args.log')
  writeFileSync(
    join(bin, 'supabase'),
    `#!/bin/bash
if [ "$1" = "--version" ]; then echo "2.99.0"; exit 0; fi
echo "$*" >> "${log}"
out=""; url=""; mode=schema; keep=0
while [ $# -gt 0 ]; do case "$1" in -f) out="$2"; shift 2;; --db-url) url="$2"; shift 2;; --data-only) mode=data; shift;; --role-only) mode=roles; shift;; --keep-comments) keep=1; shift;; *) shift;; esac; done
# Rules of the real CLI (2.120.0), reproduced here because a stand-in that accepts everything hid a real failure:
# --keep-comments cannot be combined with --data-only, and the CLI reports that error on STDOUT, not stderr.
if [ "$keep" = 1 ] && [ "$mode" = data ]; then
  echo '{"_tag":"Error","error":{"code":"DbDumpMutuallyExclusiveFlagsError","message":"if any flags in the group [keep-comments data-only] are set none of the others can be"}}'; exit 1
fi
${options.failDump ? `echo "pg_dump: error: connection to server failed ${options.echoUrlOnFailure ? '$url' : ''}" >&2; exit 1` : ''}
case "$mode" in
  schema) { ${TABLES.map((t) => `echo 'CREATE TABLE IF NOT EXISTS "public"."${t}" ('; echo ');'`).join('; ')}; echo "-- PostgreSQL database dump complete"; } > "$out" ;;
  data)   { ${options.emptyData ? '' : TABLES.map((t) => `echo 'COPY "public"."${t}" ("id") FROM stdin;'; echo '1'; echo '\\.'`).join('; ')}; echo "-- PostgreSQL database dump complete"; } > "$out" ;;
  roles)  { echo 'CREATE ROLE anon;'; } > "$out" ;;
esac
`,
  )
  writeFileSync(join(bin, 'docker'), '#!/bin/bash\nexit 0\n')
  chmodSync(join(bin, 'supabase'), 0o755)
  chmodSync(join(bin, 'docker'), 0o755)
  return { bin, log }
}

function runTake(args: string[], input: string, extraEnv: Record<string, string> = {}, bin = join(work, 'bin')) {
  return spawnSync('/bin/bash', [TAKE, ...args], {
    input,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: work,
      CONSILIUM_BACKUP_SKIP_CONNECTIVITY: '1',
      ...extraEnv,
    } as unknown as NodeJS.ProcessEnv, // a deliberately minimal environment: the script must work without the caller's
  })
}
const outFolder = () => {
  const out = join(work, 'out')
  if (!existsSync(out)) mkdirSync(out)
  return out
}
const everyOutputFile = (out: string): string[] => {
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(out)
  return files
}

// ── fixture dumps for the verifier ───────────────────────────────────────────────────────────────────────
type Counts = Record<string, number>
const baseCounts = (): Counts => Object.fromEntries(TABLES.map((t, i) => [t, i % 4]))
function makeBackup(options: { counts?: Counts; quoted?: boolean; schemaFooter?: boolean; dataFooter?: boolean; omitTable?: string; extra?: string; mode?: number; withTables?: Counts } = {}) {
  const dir = join(work, `backup-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { mode: 0o700 })
  chmodSync(dir, options.mode ?? 0o700)
  // withTables: tables a later migration added, beyond the built-in 37 (name -> rows)
  const counts = { ...(options.counts ?? baseCounts()), ...(options.withTables ?? {}) }
  const q = (s: string) => (options.quoted === false ? s : `"${s}"`)
  const tables = [...TABLES.filter((t) => t !== options.omitTable), ...Object.keys(options.withTables ?? {})]
  const schema = tables.map((t) => `CREATE TABLE IF NOT EXISTS ${options.quoted === false ? 'public' : '"public"'}.${q(t)} (\n    ${q('id')} text NOT NULL\n);\n`).join('\n') +
    (options.schemaFooter === false ? '' : '\n-- PostgreSQL database dump complete\n\\unrestrict abc\n')
  const data = tables.map((t) => `COPY ${options.quoted === false ? 'public' : '"public"'}.${q(t)} (${q('id')}) FROM stdin;\n${Array.from({ length: counts[t] }, (_, i) => `row${i}\n`).join('')}\\.\n`).join('\n') +
    (options.dataFooter === false ? '' : '\n-- PostgreSQL database dump complete\n\\unrestrict abc\n')
  writeFileSync(join(dir, 'schema.sql'), schema + (options.extra ?? ''))
  writeFileSync(join(dir, 'data.sql'), data)
  writeFileSync(join(dir, 'roles.sql'), 'CREATE ROLE anon;\n')
  for (const f of ['schema.sql', 'data.sql', 'roles.sql']) chmodSync(join(dir, f), 0o600)
  const sums = spawnSync('shasum', ['-a', '256', 'schema.sql', 'data.sql', 'roles.sql'], { cwd: dir, encoding: 'utf8' }).stdout
  writeFileSync(join(dir, 'MANIFEST.sha256'), sums)
  writeFileSync(join(dir, 'MANIFEST.txt'), 'created_utc: test\n')
  chmodSync(join(dir, 'MANIFEST.sha256'), 0o600)
  chmodSync(join(dir, 'MANIFEST.txt'), 0o600)
  return dir
}
const csv = (counts: Counts, name = 'counts.csv') => {
  const p = join(work, name)
  writeFileSync(p, 'table_name,row_count\r\n' + Object.entries(counts).map(([t, n]) => `"${t}",${n}`).join('\r\n') + '\r\n')
  return p
}
const verify = (dir: string, ...args: string[]) => spawnSync('/bin/bash', [VERIFY, dir, ...args], { encoding: 'utf8' })

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('take-supabase-backup.sh', () => {
  const PROJECT = ['--project-ref', REF]
  const ALLOW = { CONSILIUM_BACKUP_ALLOW_ANY_HOST: '0' }

  it('takes a backup, owner-only, and never lets the password reach the screen, a file or the manifest', () => {
    const { log } = shims()
    const out = outFolder()
    const r = runTake(['--out', out, ...PROJECT], GOOD_URL + '\n', ALLOW)
    expect(r.status, r.stderr).toBe(0)
    const folder = r.stdout.trim()
    expect(folder.startsWith(realpathSync(out) + '/consilium-prod-')).toBe(true) // the script resolves symlinks (/var -> /private/var on macOS)
    expect(readdirSync(folder).sort()).toEqual(['MANIFEST.sha256', 'MANIFEST.txt', 'backup.log', 'data.sql', 'roles.sql', 'schema.sql'])
    expect((statSync(folder).mode & 0o777).toString(8)).toBe('700')
    for (const f of readdirSync(folder)) expect((statSync(join(folder, f)).mode & 0o777).toString(8), f).toBe('600')

    for (const secret of [SECRET, SECRET_DECODED]) {
      expect(r.stdout).not.toContain(secret)
      expect(r.stderr).not.toContain(secret)
      for (const f of everyOutputFile(out)) expect(readFileSync(f, 'utf8'), f).not.toContain(secret)
    }
    expect(r.stderr).toContain(`host=aws-0-eu-west-2.pooler.supabase.com port=5432`)
    expect(r.stderr).toContain('password hidden')

    // what was actually asked of the CLI
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    expect(calls).toHaveLength(3)
    expect(calls.every((c) => c.includes('--db-url') && c.includes('sslmode=require'))).toBe(true)
    const schemaCall = calls.find((c) => !c.includes('--data-only') && !c.includes('--role-only'))!
    const dataCall = calls.find((c) => c.includes('--data-only'))!
    const rolesCall = calls.find((c) => c.includes('--role-only'))!
    expect(schemaCall).toContain('--keep-comments') // otherwise the CLI strips pg_dump's completion marker
    expect(dataCall).toContain('--use-copy')
    expect(dataCall).not.toContain('--keep-comments') // the real CLI rejects this pair
    expect(rolesCall).not.toContain('--keep-comments')
  })

  it('shows the real reason when the CLI fails on STDOUT (not just stderr), with the password scrubbed', () => {
    shims()
    const supabase = join(work, 'bin', 'supabase')
    // make the schema call fail the way the real CLI reports an invalid flag: JSON on stdout, nothing on stderr
    writeFileSync(supabase, readFileSync(supabase, 'utf8').replace('case "$mode" in', `echo '{"_tag":"Error","error":{"message":"boom reason ${SECRET}"}}'; exit 1\ncase "$mode" in`))
    const out = outFolder()
    const r = runTake(['--out', out, ...PROJECT], GOOD_URL + '\n', ALLOW)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('boom reason')
    expect(r.stderr).toContain('****')
    for (const secret of [SECRET, SECRET_DECODED]) {
      expect(r.stderr).not.toContain(secret)
      for (const f of everyOutputFile(out)) expect(readFileSync(f, 'utf8'), f).not.toContain(secret)
    }
    const log = everyOutputFile(out).find((f) => f.endsWith('backup.log'))!
    expect(readFileSync(log, 'utf8')).toContain('boom reason')
    // the raw (unscrubbed) CLI output must never be left inside the backup folder
    expect(readdirSync(join(log, '..')).filter((n) => n.startsWith('.') || n.includes('cli-output'))).toEqual([])
  })

  it('produces a backup that the verifier accepts (end to end)', () => {
    shims()
    const out = outFolder()
    const folder = runTake(['--out', out, ...PROJECT], GOOD_URL + '\n', ALLOW).stdout.trim()
    const counts = Object.fromEntries(TABLES.map((t) => [t, 1]))
    const v = verify(folder, '--counts-before', csv(counts))
    expect(v.stdout).toContain('RESULT: VERIFIED')
    expect(v.status).toBe(0)
  })

  it('reads the URL from a dotenv file without printing it, strips Prisma query parameters, and switches transaction mode to session mode', () => {
    const { log } = shims()
    const out = outFolder()
    const env = join(work, 'dotenv')
    writeFileSync(env, `OTHER=1\nDATABASE_URL="postgresql://u:x@h:6543/postgres?pgbouncer=true"\nDIRECT_URL="postgresql://postgres.${REF}:${SECRET}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"\n`)
    const before = readFileSync(env, 'utf8')
    const r = runTake(['--out', out, '--url-from-env-file', env, '--var', 'DIRECT_URL', ...PROJECT], '', ALLOW)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stderr).toContain('removed the query parameters')
    expect(r.stderr).toContain('changed port 6543')
    expect(r.stderr).not.toContain(SECRET)
    expect(readFileSync(env, 'utf8')).toBe(before) // never modified
    const args = readFileSync(log, 'utf8')
    expect(args).toContain(':5432/postgres?sslmode=require')
    expect(args).not.toContain('pgbouncer')
    expect(args).not.toContain('6543')
  })

  it('scrubs the password from what the CLI prints when a dump fails, and says what to do', () => {
    shims({ failDump: true, echoUrlOnFailure: true })
    const out = outFolder()
    const r = runTake(['--out', out, ...PROJECT], GOOD_URL + '\n', ALLOW)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('FAILED')
    expect(r.stderr).toContain('server version mismatch')
    expect(r.stderr).toContain('do NOT reset it')
    expect(r.stderr).toContain('****')
    for (const secret of [SECRET, SECRET_DECODED]) {
      expect(r.stderr).not.toContain(secret)
      for (const f of everyOutputFile(out)) expect(readFileSync(f, 'utf8'), f).not.toContain(secret)
    }
    expect(r.stderr).not.toContain('VERIFIED')
  })

  it('fails if a dump comes out empty, rather than reporting success', () => {
    shims({ emptyData: false })
    // an empty roles file: replace the shim's roles output with nothing
    const supabase = join(work, 'bin', 'supabase')
    writeFileSync(supabase, readFileSync(supabase, 'utf8').replace("echo 'CREATE ROLE anon;'", ':'))
    const r = runTake(['--out', outFolder(), ...PROJECT], GOOD_URL + '\n', ALLOW)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('is empty')
  })

  describe('refuses before touching anything', () => {
    const cases: [string, string, string[], string][] = [
      ['a different Supabase project', `postgresql://postgres.otherprojectotherproj:${SECRET}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`, [], "not '" + REF + "'"],
      ['a host that is not Supabase', `postgresql://postgres.${REF}:${SECRET}@evil.example.com:5432/postgres`, [], 'not a Supabase host'],
      ['something that is not a Postgres URL', 'https://example.com', [], 'does not look like a Postgres connection string'],
      ['a URL without a password', `postgresql://postgres.${REF}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`, [], 'no password'],
      ['an unencoded @ in the password', `postgresql://postgres.${REF}:pa@ss@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`, [], 'unencoded @'],
      ['an unencoded special character', `postgresql://postgres.${REF}:pa/ss@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`, [], 'percent-encoded'],
      ['an empty entry', '', [], 'nothing was entered'],
    ]
    it.each(cases)('%s', (_label, url, extra, message) => {
      const { log } = shims()
      const r = runTake(['--out', outFolder(), ...PROJECT, ...extra], url + '\n', ALLOW)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(message)
      expect(existsSync(log)).toBe(false) // the CLI was never called
      expect(readdirSync(join(work, 'out'))).toEqual([]) // nothing created
      expect(r.stderr).not.toContain(SECRET)
    })

    it('a missing --out, and an --out that is not a folder', () => {
      shims()
      expect(runTake([...PROJECT], GOOD_URL + '\n', ALLOW).stderr).toContain('--out is required')
      expect(runTake(['--out', join(work, 'nope'), ...PROJECT], GOOD_URL + '\n', ALLOW).stderr).toContain('not an existing folder')
    })

    it('an output folder inside a git repository, or a cloud-synced folder', () => {
      shims()
      const repo = join(work, 'repo')
      mkdirSync(repo)
      spawnSync('git', ['init', '-q'], { cwd: repo })
      const inRepo = runTake(['--out', repo, ...PROJECT], GOOD_URL + '\n', ALLOW)
      expect(inRepo.status).toBe(1)
      expect(inRepo.stderr).toContain('inside a git repository')

      const synced = join(work, 'Dropbox')
      mkdirSync(synced)
      const inCloud = runTake(['--out', synced, ...PROJECT], GOOD_URL + '\n', ALLOW)
      expect(inCloud.status).toBe(1)
      expect(inCloud.stderr).toContain('cloud-synced')
    })

    it('a missing Supabase CLI or Docker, with the install command', () => {
      const empty = join(work, 'emptybin')
      mkdirSync(empty)
      const r = runTake(['--out', outFolder(), ...PROJECT], GOOD_URL + '\n', ALLOW, empty)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('brew install supabase/tap/supabase')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('verify-supabase-backup.sh', () => {
  it('accepts a good backup whose row counts match, in the Supabase CLI style (quoted identifiers) and plain style', () => {
    for (const quoted of [true, false]) {
      const dir = makeBackup({ quoted })
      const r = verify(dir, '--counts-before', csv(baseCounts()))
      expect(r.stdout, r.stdout).toContain('RESULT: VERIFIED')
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('data.sql has a data block for all 37 expected tables')
    }
  })

  it('counts the rows inside each data block (not merely that the block exists)', () => {
    const counts = { ...baseCounts(), subscribers: 3, users: 7, ArticleTrophy: 2 }
    const r = verify(makeBackup({ counts }), '--counts-before', csv(counts))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/subscribers\s+3\s+3\s+3\s+ok/)
    expect(r.stdout).toMatch(/ArticleTrophy\s+2\s+2\s+2\s+ok/)
  })

  it('FAILS when the backup has fewer rows than production (rows silently missing)', () => {
    const live = { ...baseCounts(), subscribers: 3 }
    const dumped = { ...baseCounts(), subscribers: 2 }
    const r = verify(makeBackup({ counts: dumped }), '--counts-before', csv(live))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/subscribers\s+2\s+3\s+3\s+MISMATCH/)
    expect(r.stdout).toContain('NOT VERIFIED')
  })

  it('FAILS when the backup has MORE rows than production', () => {
    const r = verify(makeBackup({ counts: { ...baseCounts(), users: 9 } }), '--counts-before', csv({ ...baseCounts(), users: 8 }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/users\s+9\s+8\s+8\s+MISMATCH/)
  })

  it('allows a table that changed while the dump ran, if the backup lies between the before and after counts', () => {
    const before = { ...baseCounts(), article_views: 100 }
    const after = { ...baseCounts(), article_views: 104 }
    expect(verify(makeBackup({ counts: { ...baseCounts(), article_views: 102 } }), '--counts-before', csv(before, 'b.csv'), '--counts-after', csv(after, 'a.csv')).status).toBe(0)
    expect(verify(makeBackup({ counts: { ...baseCounts(), article_views: 99 } }), '--counts-before', csv(before, 'b.csv'), '--counts-after', csv(after, 'a.csv')).status).toBe(1)
    expect(verify(makeBackup({ counts: { ...baseCounts(), article_views: 105 } }), '--counts-before', csv(before, 'b.csv'), '--counts-after', csv(after, 'a.csv')).status).toBe(1)
  })

  it('FAILS without live counts: it will not call a backup verified on file checks alone', () => {
    const r = verify(makeBackup())
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('no --counts-before file')
  })

  it('FAILS on a truncated schema or data file (no completion marker)', () => {
    expect(verify(makeBackup({ schemaFooter: false }), '--counts-before', csv(baseCounts())).stdout).toContain('schema.sql does NOT end with the completion marker')
    const r = verify(makeBackup({ dataFooter: false }), '--counts-before', csv(baseCounts()))
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('data.sql does NOT end with the completion marker')
  })

  it('FAILS when a table is missing from the schema and from the data', () => {
    const r = verify(makeBackup({ omitTable: 'subscribers' }), '--counts-before', csv(baseCounts()))
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('schema.sql is missing: subscribers')
    expect(r.stdout).toContain('no data block for: subscribers')
  })

  it('also checks tables that a later migration added (anything in the live counts), not just the built-in 37', () => {
    const added = { article_image_assets: 3, scheduler_invocations: 5 }
    const live = { ...baseCounts(), ...added }
    // present in the backup with matching counts: verified, and the extra tables are shown in the table
    const good = verify(makeBackup({ withTables: added }), '--counts-before', csv(live))
    expect(good.status, good.stdout).toBe(0)
    expect(good.stdout).toContain('also checking tables found in the live counts')
    expect(good.stdout).toMatch(/article_image_assets\s+3\s+3\s+3\s+ok/)
    expect(good.stdout).toContain('data.sql has a data block for all 39 expected tables')
    // live has them, backup does not: must FAIL (previously these were silently ignored)
    const missing = verify(makeBackup(), '--counts-before', csv(live))
    expect(missing.status).toBe(1)
    expect(missing.stdout).toContain('schema.sql is missing: article_image_assets scheduler_invocations')
    expect(missing.stdout).toContain('no data block for: article_image_assets scheduler_invocations')
    // present with the wrong number of rows: must FAIL
    const wrong = verify(makeBackup({ withTables: { ...added, scheduler_invocations: 4 } }), '--counts-before', csv(live))
    expect(wrong.status).toBe(1)
    expect(wrong.stdout).toMatch(/scheduler_invocations\s+4\s+5\s+5\s+MISMATCH/)
  })

  it('does not say the row contents were compared', () => {
    const r = verify(makeBackup(), '--counts-before', csv(baseCounts()))
    expect(r.stdout).toContain('does not compare row contents')
  })

  it('FAILS if a file was changed after it was written (checksum)', () => {
    const dir = makeBackup()
    writeFileSync(join(dir, 'data.sql'), readFileSync(join(dir, 'data.sql'), 'utf8') + '-- tampered\n')
    const r = verify(dir, '--counts-before', csv(baseCounts()))
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('SHA-256 does not match')
  })

  it('FAILS if the backup is readable by other users', () => {
    const dir = makeBackup({ mode: 0o755 })
    const r = verify(dir, '--counts-before', csv(baseCounts()))
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('folder is readable by others')
    chmodSync(join(dir, 'schema.sql'), 0o644)
    expect(verify(dir, '--counts-before', csv(baseCounts())).stdout).toContain('schema.sql is readable by others')
  })

  it('FAILS if a file contains a connection string with a password, and if roles.sql has a role password', () => {
    const leaked = makeBackup({ extra: '\n-- postgresql://postgres.abc:hunter2@aws-0.pooler.supabase.com:5432/postgres\n' })
    expect(verify(leaked, '--counts-before', csv(baseCounts())).stdout).toContain('looks like a connection string')
    const dir = makeBackup()
    writeFileSync(join(dir, 'roles.sql'), "CREATE ROLE app PASSWORD 'abc';\n")
    expect(verify(dir, '--counts-before', csv(baseCounts())).stdout).toContain('roles.sql contains a role password')
  })

  it('FAILS on a missing file, and reports a table the counts file lacks', () => {
    const dir = makeBackup()
    rmSync(join(dir, 'roles.sql'))
    expect(verify(dir, '--counts-before', csv(baseCounts())).status).toBe(1)
    const partial = baseCounts()
    delete (partial as Record<string, number>).users
    const r = verify(makeBackup(), '--counts-before', csv(partial))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/users\s+\S+\s+-\s+-\s+MISSING/)
  })

  it('rejects bad usage with exit status 2', () => {
    expect(spawnSync('/bin/bash', [VERIFY], { encoding: 'utf8' }).status).toBe(2)
    expect(spawnSync('/bin/bash', [VERIFY, join(work, 'missing')], { encoding: 'utf8' }).status).toBe(2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// The stand-in `supabase` above only knows the rules it was told. This block asks the REAL, installed CLI.
// `--dry-run` only prints the pg_dump script it would run: it opens no connection (the URL below is a dummy that
// points nowhere) and needs no Docker, so it is safe anywhere. Skipped when the CLI is not installed.
const realCli = spawnSync('supabase', ['--version'], { encoding: 'utf8' })
const hasRealCli = realCli.status === 0
describe.skipIf(!hasRealCli)(`the flags the script uses are accepted by the installed Supabase CLI (${hasRealCli ? realCli.stdout.trim() : 'not installed'})`, () => {
  const dryRun = (flags: string[]) =>
    spawnSync('supabase', ['db', 'dump', '--db-url', 'postgresql://postgres:dummy@127.0.0.1:1/postgres?sslmode=disable', '--dry-run', ...flags], { cwd: work, encoding: 'utf8', timeout: 60_000 })
  // the exact flags of every run_dump call in the script, so this cannot drift from what the script really does
  const calls = [...readFileSync(TAKE, 'utf8').matchAll(/^run_dump\s+"[^"]*"\s+"\$DEST\/(\w+)\.sql"\s+(.+)$/gm)].map((m) => ({ file: m[1], flags: m[2].trim().split(/\s+/) }))

  it('finds the three dump calls in the script', () => {
    expect(calls.map((c) => c.file)).toEqual(['schema', 'data', 'roles'])
  })

  it.each(['schema', 'data', 'roles'])('accepts the flags of the %s dump', (file) => {
    const call = calls.find((c) => c.file === file)!
    const r = dryRun(call.flags)
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)
    expect(r.stdout + r.stderr).toContain('DRY RUN')
  })

  it('still rejects --keep-comments together with --data-only (why the data dump must not pass it)', () => {
    const r = dryRun(['--keep-comments', '--data-only'])
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toMatch(/mutually|none of the others/i)
  })

  it('keeps the completion marker only when --keep-comments is given (why the schema dump needs it)', () => {
    expect(dryRun([]).stdout).toContain('sed -E "/^--/d"')
    expect(dryRun(['--keep-comments']).stdout).not.toContain('sed -E "/^--/d"')
  })
})

describe('the guide matches the scripts', () => {
  const guide = readFileSync(join(ROOT, 'docs/remediation/backup-and-verify.md'), 'utf8')
  const takeSource = readFileSync(TAKE, 'utf8')
  const verifySource = readFileSync(VERIFY, 'utf8')

  it('every option the guide tells you to type exists in the script it names', () => {
    const lines = guide.split('\n')
    let inspected = 0
    for (const [script, source] of [['take-supabase-backup.sh', takeSource], ['verify-supabase-backup.sh', verifySource]] as const) {
      // an invocation may continue onto following lines with a trailing backslash
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(`scripts/backup/${script}`) || !lines[i].trim().startsWith('scripts/backup/')) continue
        let command = lines[i]
        while (command.trimEnd().endsWith('\\') && i + 1 < lines.length) command += lines[++i]
        for (const flag of command.match(/--[a-z][a-z-]*/g) ?? []) {
          inspected += 1
          expect(source, `${script} should know ${flag}`).toContain(flag)
        }
      }
    }
    expect(inspected, 'the guide should contain several script options to check').toBeGreaterThanOrEqual(6)
  })

  it('refers to files that exist, and to the project and counts the scripts use', () => {
    for (const f of ['scripts/backup/table-row-counts.sql', 'scripts/backup/take-supabase-backup.sh', 'scripts/backup/verify-supabase-backup.sh']) {
      expect(guide).toContain(f)
      expect(existsSync(join(ROOT, f)), f).toBe(true)
    }
    expect(guide).toContain('scllbuwkcqtmfogsgalt')
    expect(takeSource).toContain('scllbuwkcqtmfogsgalt')
    expect(guide).toContain('the 37 core tables')
    expect(guide).toContain('every table in the live counts')
  })

  it('never tells the reader to reset the database password, or to type a connection string on a command line', () => {
    expect(guide).toContain('Do not reset the database password')
    expect(guide).not.toMatch(/--db-url\s+["']?postgres/)
    expect(guide).not.toMatch(/export\s+(DB_)?URL=/)
  })
})

describe('the row-count query', () => {
  it('is a single read-only SELECT returning names and numbers only', () => {
    const sql = readFileSync(join(ROOT, 'scripts/backup/table-row-counts.sql'), 'utf8').replace(/--.*$/gm, '')
    expect(sql.trim().startsWith('select')).toBe(true)
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i)
    expect(sql.match(/;/g)).toHaveLength(1)
  })
})
