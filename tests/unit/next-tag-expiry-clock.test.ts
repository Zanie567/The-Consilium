import { afterEach, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

// Next 16.3+ judges tag expiry with the monotonic clock while its self-hosted data cache stamps the
// expiry with Date.now(); scripts/patch-next-tag-expiry-clock.mjs (postinstall) takes the later clock.
const require = createRequire(import.meta.url)
const modulePath = require.resolve('next/dist/server/lib/incremental-cache/tags-manifest.external.js')
const { areTagsExpired, tagsManifest } = require(modulePath) as {
  areTagsExpired: (tags: string[], timestamp: number) => boolean
  tagsManifest: Map<string, { expired?: number; stale?: number }>
}
const realNow = performance.now.bind(performance)
afterEach(() => { performance.now = realNow; tagsManifest.delete('consilium-test') })

it('the installed Next carries the patch in both module formats', () => {
  for (const file of [modulePath, require.resolve('next/dist/esm/server/lib/incremental-cache/tags-manifest.external.js')]) {
    expect(readFileSync(file, 'utf8')).toContain('Math.max(Date.now(), performance.timeOrigin + performance.now())')
  }
})

it('a fresh invalidation is honoured even when the monotonic clock lags the wall clock', () => {
  const written = Date.now() - 1000 // a cached list written a second ago
  tagsManifest.set('consilium-test', { expired: Date.now() }) // the file-system cache stamps with Date.now()
  performance.now = () => realNow() - 60_000 // e.g. after a minute of sleep or suspension
  expect(areTagsExpired(['consilium-test'], written)).toBe(true)
})

it('an entry written after the invalidation is still fresh, and future expiries still wait', () => {
  const invalidatedAt = Date.now() - 1000
  tagsManifest.set('consilium-test', { expired: invalidatedAt })
  expect(areTagsExpired(['consilium-test'], Date.now())).toBe(false) // re-cached after the expiry
  tagsManifest.set('consilium-test', { expired: Date.now() + 60_000 })
  expect(areTagsExpired(['consilium-test'], Date.now() - 1000)).toBe(false) // a scheduled expiry has not come yet
})
