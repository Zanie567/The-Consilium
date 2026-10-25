import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { changedSinceLastDeployment, decide, isNonRuntimePath } from '../../scripts/vercel-ignore-build.mjs'

const preview = (extra: Record<string, string> = {}) => ({ VERCEL_ENV: 'preview', ...extra })

describe('production is never skipped', () => {
  it.each([
    [{ VERCEL_ENV: 'production' }, ['docs/x.md']],
    [{ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_MESSAGE: 'docs [skip preview]' }, []],
    [{ VERCEL_ENV: 'production' }, null],
    [{}, ['tests/a.test.ts']], // unknown environment
    [{ VERCEL_ENV: 'development' }, ['docs/x.md']],
  ])('%o builds', (env, changedFiles) => {
    expect(decide({ env, changedFiles }).build).toBe(true)
  })
})

describe('previews', () => {
  it('skip when only tests, docs, CI workflows or SQL changed', () => {
    const changedFiles = [
      'tests/unit/a.test.ts', 'tests/e2e/b.spec.ts', 'docs/ops/c.md', '.github/workflows/ci.yml',
      'supabase/migrations/20261025_x.sql', 'scripts/backup/take-supabase-backup.sh', 'README.md',
      'playwright.config.ts', 'vitest.config.ts', 'vitest.data-api.config.ts', 'prisma/seed.ts',
    ]
    expect(decide({ env: preview(), changedFiles })).toMatchObject({ build: false })
  })

  it.each([
    'src/proxy.ts', 'src/app/page.tsx', 'public/logo.png', 'package.json', 'package-lock.json',
    'next.config.ts', 'vercel.json', 'prisma/schema.prisma', 'scripts/next-build.mjs',
    'scripts/lib/assertRunDatabase.ts', 'scripts/vercel-ignore-build.mjs', 'scripts/patch-next-tag-expiry-clock.mjs',
    'src/README.md', 'tsconfig.json', 'postcss.config.mjs', 'prisma.config.ts',
  ])('build when %s changed', (file) => {
    expect(decide({ env: preview(), changedFiles: ['docs/x.md', file] }).build).toBe(true)
  })

  it('build when the change set is unknown', () => {
    expect(decide({ env: preview(), changedFiles: null }).build).toBe(true)
  })

  it('skip when nothing changed since the last deployment', () => {
    expect(decide({ env: preview(), changedFiles: [] }).build).toBe(false)
  })

  it('honour [preview] and [skip preview] in the commit message, [preview] winning', () => {
    expect(decide({ env: preview({ VERCEL_GIT_COMMIT_MESSAGE: 'test: x [preview]' }), changedFiles: ['tests/a.ts'] }).build).toBe(true)
    expect(decide({ env: preview({ VERCEL_GIT_COMMIT_MESSAGE: 'feat: y\n\n[skip preview]' }), changedFiles: ['src/a.ts'] }).build).toBe(false)
    expect(decide({ env: preview({ VERCEL_GIT_COMMIT_MESSAGE: 'feat: z [No Preview]' }), changedFiles: ['src/a.ts'] }).build).toBe(false)
    expect(decide({ env: preview({ VERCEL_GIT_COMMIT_MESSAGE: '[skip preview] [preview]' }), changedFiles: ['src/a.ts'] }).build).toBe(true)
  })
})

it('treats only listed paths as non-runtime', () => {
  expect(isNonRuntimePath('docs/a/b.md')).toBe(true)
  expect(isNonRuntimePath('src/docs/a.ts')).toBe(false)
  expect(isNonRuntimePath('scripts/run-e2e.sh')).toBe(false)
  expect(isNonRuntimePath('testsuite/a.ts')).toBe(false)
})

describe('changedSinceLastDeployment', () => {
  it('rejects a malformed previous deployment SHA without running git', () => {
    const git = vi.fn(() => '')
    expect(changedSinceLastDeployment({ VERCEL_GIT_PREVIOUS_SHA: 'HEAD; rm -rf /' }, git)).toBeNull()
    expect(changedSinceLastDeployment({ VERCEL_GIT_PREVIOUS_SHA: '--output=/tmp/x' }, git)).toBeNull()
    expect(git).not.toHaveBeenCalled()
  })

  it('is unknown on a first deployment when main cannot be fetched', () => {
    const failing = () => { throw new Error('fatal: could not read from remote repository') }
    expect(changedSinceLastDeployment({}, failing)).toBeNull()
  })

  it('is unknown when git fails, so the preview builds', () => {
    const failing = () => { throw new Error('fatal: not a git repository') }
    expect(changedSinceLastDeployment({ VERCEL_GIT_PREVIOUS_SHA: 'abcdef1' }, failing)).toBeNull()
  })

  const gitIn = (dir: string) => (...args: string[]) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } })
    if (r.status !== 0) throw new Error(r.stderr)
    return r.stdout
  }
  const writeIn = (dir: string) => (file: string) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), file + Math.random()) }

  it('lists files changed since the previous deployment in a real repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ignore-build-'))
    const git = gitIn(dir); const write = writeIn(dir)
    git('init', '-q'); write('src/a.ts'); git('add', '.'); git('commit', '-qm', 'one')
    const previous = git('rev-parse', 'HEAD').trim()
    write('tests/unit/b.test.ts'); write('docs/c.md'); git('add', '.'); git('commit', '-qm', 'two')
    const files = changedSinceLastDeployment({ VERCEL_GIT_PREVIOUS_SHA: previous }, git)
    expect(files?.sort()).toEqual(['docs/c.md', 'tests/unit/b.test.ts'])
    expect(decide({ env: preview(), changedFiles: files }).build).toBe(false)
  })

  it("on a branch's first deployment, lists files changed since it left main", () => {
    const origin = mkdtempSync(join(tmpdir(), 'ignore-build-origin-'))
    const g = gitIn(origin); const w = writeIn(origin)
    g('init', '-q', '-b', 'main'); w('src/a.ts'); g('add', '.'); g('commit', '-qm', 'base')
    g('checkout', '-qb', 'test/only'); w('tests/unit/x.test.ts'); g('add', '.'); g('commit', '-qm', 'test only')
    g('checkout', '-q', 'main'); w('src/b.ts'); g('add', '.'); g('commit', '-qm', 'main moved on')
    const clone = mkdtempSync(join(tmpdir(), 'ignore-build-clone-'))
    spawnSync('git', ['clone', '-q', '--branch', 'test/only', `file://${origin}`, clone])
    const files = changedSinceLastDeployment({}, gitIn(clone))
    // main's own later change (src/b.ts) is not part of this branch.
    expect(files).toEqual(['tests/unit/x.test.ts'])
    expect(decide({ env: preview(), changedFiles: files }).build).toBe(false)
  })
})

describe('as Vercel runs it', () => {
  const script = resolve(__dirname, '../../scripts/vercel-ignore-build.mjs')
  // Outside any git repository, so nothing here can reach the network; git fails and it builds.
  const cwd = mkdtempSync(join(tmpdir(), 'ignore-build-nogit-'))
  const run = (env: Record<string, string>) => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', GIT_CEILING_DIRECTORIES: tmpdir(), ...env } as unknown as NodeJS.ProcessEnv })

  it('exits 1 (build) for production', () => {
    const r = run({ VERCEL_ENV: 'production' })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/BUILD - production deployment/)
  })

  it('exits 0 (skip) for a preview that asks to skip', () => {
    const r = run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_MESSAGE: 'wip [skip preview]' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/SKIP/)
  })

  it('exits 1 (build) for a first preview of a branch (no previous deployment)', () => {
    expect(run({ VERCEL_ENV: 'preview' }).status).toBe(1)
  })
})

it('vercel.json runs this script as the Ignored Build Step and keeps the Dublin region', async () => {
  const { readFileSync } = await import('node:fs')
  const config = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8'))
  expect(config.ignoreCommand).toBe('node scripts/vercel-ignore-build.mjs')
  expect(config.regions).toEqual(['dub1'])
})
