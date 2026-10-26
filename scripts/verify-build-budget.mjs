// Post-build guard: no prerendered page may be rebuilt on a short timer by accident.
//
// A route revalidates as often as the shortest cache used anywhere in it (layout, footer, page).
// Until October 2026 the footer's LinkedIn link cached for 60 seconds, so /about, /privacy,
// /terms and every other static page was rebuilt about once a minute while anyone was reading
// it, each rebuild a billed Vercel function invocation. This reads Next's prerender manifest and
// fails when a route's timer is shorter than MIN_REVALIDATE_SECONDS, unless it is listed in
// ALLOWED_SHORT_REVALIDATE with a reason. Content that must appear sooner should be invalidated
// on write (revalidateTag / revalidatePath), not polled.
//
//   node scripts/verify-build-budget.mjs        # after `next build`
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MIN_REVALIDATE_SECONDS = 3600

/** route -> why it needs a shorter timer. Empty on purpose. */
export const ALLOWED_SHORT_REVALIDATE = {}

/** Routes whose revalidate timer is a number below the floor and not allow-listed. */
export function findShortRevalidations(manifest, { min = MIN_REVALIDATE_SECONDS, allowed = ALLOWED_SHORT_REVALIDATE } = {}) {
  const short = []
  for (const [route, info] of Object.entries(manifest.routes ?? {})) {
    const seconds = info?.initialRevalidateSeconds
    if (typeof seconds !== 'number' || seconds === 0) continue // false = never; 0 = dynamic
    if (seconds < min && !Object.hasOwn(allowed, route)) short.push({ route, seconds })
  }
  return short.sort((a, b) => a.route.localeCompare(b.route))
}

function main() {
  const distDir = process.env.NEXT_DIST_DIR || '.next'
  const manifestPath = join(distDir, 'prerender-manifest.json')
  if (!existsSync(manifestPath)) {
    console.error(`verify-build-budget: ${manifestPath} not found - run "next build" first.`)
    process.exit(1)
  }
  const short = findShortRevalidations(JSON.parse(readFileSync(manifestPath, 'utf8')))
  if (short.length > 0) {
    console.error(`verify-build-budget: these prerendered routes rebuild more often than every ${MIN_REVALIDATE_SECONDS} s:`)
    for (const { route, seconds } of short) console.error(`  - ${route}: every ${seconds} s`)
    console.error('Find the short cache (unstable_cache / fetch revalidate / segment config) used by the route,')
    console.error('invalidate it on write instead, or add the route to ALLOWED_SHORT_REVALIDATE with a reason.')
    process.exit(1)
  }
  console.log(`verify-build-budget: ok (no prerendered route rebuilds more often than every ${MIN_REVALIDATE_SECONDS} s)`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
