// Guard for the Next.js image-optimizer abort fix (upstream PR #98168).
// https://github.com/vercel/next.js/pull/98168
//
// History: on Next 16.2.2 this script patched both module distributions so the internal image
// request kept the client's socket while the shared mocked response stayed independent of it.
// Without that, a client that disconnected mid-transfer left the coalesced cache key pending for
// every later requester until the server restarted.
//
// Next 16.4.2 ships the same fix upstream, so nothing is patched any more. This script now only
// proves the fix is present in the installed Next, and refuses any other version until someone
// has checked it (scripts/diagnostics/image-optimizer-abort.mjs reproduces the failure).
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { version } = require('next/package.json')
const REVIEWED = '16.4.2'
if (version !== REVIEWED) {
  throw new Error(`Next ${version} is installed; check that it still contains Next.js #98168 (image-optimizer abort) before changing scripts/backport-next-image-abort.mjs (reviewed: ${REVIEWED}).`)
}
for (const [file, request, response] of [
  ['next/dist/server/image-optimizer.js', 'req: new _mockrequest.MockedRequest({', 'res: new _mockrequest.MockedResponse({'],
  ['next/dist/esm/server/image-optimizer.js', 'req: new MockedRequest({', 'res: new MockedResponse({'],
]) {
  const source = fs.readFileSync(require.resolve(file), 'utf8')
  const start = source.indexOf('const mocked = {')
  const block = start === -1 ? '' : source.slice(start, source.indexOf('};', start))
  // The fix: the request carries the socket; the response is constructed without one.
  if (!block.includes(request) || !block.includes('socket: _req.socket') || !block.includes(response)
      || block.slice(block.indexOf(response)).includes('socket')) {
    throw new Error(`Next.js #98168 is not present in ${file}; do not install this Next version without the fix.`)
  }
}

// src/lib/cacheInvalidation.ts waits for queued cache invalidations through these internals (read-after-write
// for publish/withdraw/trash since Next 16.3 moved the write after the response). Fail the install, not
// production, if a Next change removes them.
const { executeRevalidates } = require('next/dist/server/revalidation-utils')
const workStorageSource = fs.readFileSync(require.resolve('next/dist/server/app-render/work-async-storage.external.js'), 'utf8')
if (typeof executeRevalidates !== 'function' || !/workAsyncStorage/.test(workStorageSource)) {
  throw new Error('Next internals used by src/lib/cacheInvalidation.ts changed; review read-after-write before upgrading.')
}
