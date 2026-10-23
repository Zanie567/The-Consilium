import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOOGLE_FONT_QUERY_FAILURE, isGoogleFontQueryFailure, runBuild } from '../../scripts/next-build.mjs'

// scripts/next-build.mjs retries `next build` only for vercel/next.js#99114 (an unusable Google
// Fonts response that fails Turbopack's next/font/google loader). Fake builds stand in for Next.
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A fake build that fails with `failures[i]` on attempt i and succeeds once they run out. */
function fakeBuild(failures: { message: string; code?: number }[]) {
  const dir = mkdtempSync(join(tmpdir(), 'next-build-'))
  dirs.push(dir)
  const counter = join(dir, 'attempts')
  writeFileSync(counter, '0')
  const script = join(dir, 'build.mjs')
  writeFileSync(script, `
    import { readFileSync, writeFileSync } from 'node:fs'
    const failures = ${JSON.stringify(failures)}
    const attempt = Number(readFileSync(${JSON.stringify(counter)}, 'utf8'))
    writeFileSync(${JSON.stringify(counter)}, String(attempt + 1))
    const failure = failures[attempt]
    if (!failure) { console.log('Compiled successfully'); process.exit(0) }
    console.error(failure.message)
    process.exit(failure.code ?? 1)
  `)
  return { args: [script], attempts: () => Number(readFileSync(counter, 'utf8')) }
}

const FONT_FAILURE = `> Build error occurred\nError: Turbopack build failed with 56 errors:\n` +
  `Error while looking up import map: ${GOOGLE_FONT_QUERY_FAILURE}\n`
const quiet = () => {}

describe('next build wrapper', () => {
  it('recognises only the upstream Google font failure', () => {
    expect(isGoogleFontQueryFailure(FONT_FAILURE)).toBe(true)
    expect(isGoogleFontQueryFailure('Type error: Property "x" does not exist')).toBe(false)
    expect(isGoogleFontQueryFailure("Module not found: Can't resolve './missing'")).toBe(false)
  })

  it('a clean build runs once', async () => {
    const build = fakeBuild([])
    expect(await runBuild({ command: process.execPath, args: build.args, log: quiet })).toBe(0)
    expect(build.attempts()).toBe(1)
  })

  it('retries the Google font failure and succeeds on a fresh download', async () => {
    const build = fakeBuild([{ message: FONT_FAILURE }])
    expect(await runBuild({ command: process.execPath, args: build.args, log: quiet })).toBe(0)
    expect(build.attempts()).toBe(2)
  })

  it('stops after the last attempt and keeps the failing exit code', async () => {
    const build = fakeBuild([{ message: FONT_FAILURE, code: 7 }, { message: FONT_FAILURE, code: 7 }, { message: FONT_FAILURE, code: 7 }])
    expect(await runBuild({ command: process.execPath, args: build.args, log: quiet })).toBe(7)
    expect(build.attempts()).toBe(3)
  })

  it('never retries any other failure', async () => {
    const build = fakeBuild([{ message: 'Type error: Property "x" does not exist', code: 1 }])
    expect(await runBuild({ command: process.execPath, args: build.args, log: quiet })).toBe(1)
    expect(build.attempts()).toBe(1)
  })
})
