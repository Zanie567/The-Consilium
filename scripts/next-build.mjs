// `npm run build`: run `next build`, retrying only the next/font/google build failure below.
//
// next/font/google downloads the Google Fonts stylesheet during every build. About 1 in 60 of
// Google's responses list the font files as extensionless `fonts.gstatic.com/l/font?kit=...&skey=...`
// URLs instead of `/s/.../*.woff2`. Turbopack's Google font loader splits those URLs on "&" and
// fails the whole build with "next/font/google queries have exactly one entry", one error per font
// file (https://github.com/vercel/next.js/issues/99114, still present in 16.4.x; the webpack loader
// fails on the same responses). The response is a 200, so Next's own fetch retry does not help.
// It failed a Vercel preview build and main's CI build on 23 October 2026, with unchanged code.
//
// Each attempt runs in a fresh process and Turbopack's build cache is off by default
// (experimental.turbopackFileSystemCacheForBuild), so a retry fetches a new stylesheet. Any other
// failure is reported immediately, exactly as before. Remove this wrapper (and restore
// `"build": "next build"`) once upstream handles these URLs.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const GOOGLE_FONT_QUERY_FAILURE = 'next/font/google queries have exactly one entry'
export const MAX_ATTEMPTS = 3
const TAIL_BYTES = 256 * 1024 // the error is printed at the end of the build output

/** True when a failed build's output shows the upstream next/font/google URL failure. */
export function isGoogleFontQueryFailure(output) {
  return output.includes(GOOGLE_FONT_QUERY_FAILURE)
}

function runOnce(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env })
    let tail = ''
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-TAIL_BYTES)
    }
    child.stdout.on('data', (chunk) => { process.stdout.write(chunk); keep(chunk) })
    child.stderr.on('data', (chunk) => { process.stderr.write(chunk); keep(chunk) })
    child.on('error', (error) => resolve({ code: 1, output: `${tail}\n${error.message}` }))
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), output: tail }))
  })
}

/** Runs the build, retrying only the Google font failure. Resolves to the exit code. */
export async function runBuild({ command, args, maxAttempts = MAX_ATTEMPTS, log = console.error }) {
  for (let attempt = 1; ; attempt++) {
    const { code, output } = await runOnce(command, args)
    if (code === 0) return 0
    if (attempt >= maxAttempts || !isGoogleFontQueryFailure(output)) return code
    log(`\n[next-build] Attempt ${attempt} of ${maxAttempts} failed on an unusable Google Fonts response ` +
      `(vercel/next.js#99114). Retrying with a fresh download.\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  const code = await runBuild({ command: process.execPath, args: [nextBin, 'build', ...process.argv.slice(2)] })
  process.exit(code)
}
