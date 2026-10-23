// Restore wall-clock-consistent tag expiry in Next's self-hosted data cache (Next 16.3+ regression).
//
// Next 16.2 decided "has this tag been invalidated?" with Date.now(). Since 16.3,
// areTagsExpired() compares against the monotonic clock (performance.timeOrigin +
// performance.now()), while the file-system cache that backs unstable_cache when self-hosted
// still stamps the expiry with Date.now(). The two clocks drift apart: by about 0.4 ms a minute
// on the development machine, and by the whole duration of any sleep or suspension, during which
// the monotonic clock stops. While the wall clock is ahead, a fresh invalidation looks like it is
// in the future and is IGNORED, so a just-withdrawn article stays in cached lists, the RSS feed or
// the sitemap. The isolated browser suite caught it (wf-feed-invalidation, the topic and LinkedIn
// caches); scripts/diagnostics show it with Next's own module.
//
// The patch takes the later of the two clocks. An invalidation can then only take effect sooner,
// never later, and stays correct for both writers: the file-system cache (wall clock) and the
// 'use cache' handler (monotonic clock). Present in 16.3.0 through 16.5.0-canary.23; remove it when
// upstream fixes the inconsistency. Version-pinned and verified like the image-abort guard.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { version } = require('next/package.json')
const REVIEWED = '16.4.2'
if (version !== REVIEWED) {
  throw new Error(`Next ${version} is installed; review scripts/patch-next-tag-expiry-clock.mjs (reviewed: ${REVIEWED}).`)
}
const ORIGINAL = 'const now = performance.timeOrigin + performance.now();'
const PATCHED = 'const now = Math.max(Date.now(), performance.timeOrigin + performance.now()); // Consilium: tag expiry is stamped with Date.now() by the file-system cache'
const updates = []
for (const file of [
  'next/dist/server/lib/incremental-cache/tags-manifest.external.js',
  'next/dist/esm/server/lib/incremental-cache/tags-manifest.external.js',
]) {
  const location = require.resolve(file)
  const source = fs.readFileSync(location, 'utf8')
  if (source.includes(PATCHED)) continue // idempotent
  const start = source.search(/areTagsExpired\s*=\s*\(/)
  const body = start === -1 ? '' : source.slice(start, source.search(/areTagsStale\s*=\s*\(/))
  if (source.split(ORIGINAL).length !== 2 || !body.includes(ORIGINAL)) {
    throw new Error(`Unexpected Next source in ${file}; refusing an ambiguous patch.`)
  }
  updates.push([location, source.replace(ORIGINAL, PATCHED)])
}
// Validate both distributions before writing either one.
for (const [location, source] of updates) fs.writeFileSync(location, source)
