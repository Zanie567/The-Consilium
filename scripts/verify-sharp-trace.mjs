// Post-build guard: the /api/upload function must ship sharp's native libvips.
//
// sharp's .node binary finds libvips through an rpath (dlopen), which Next's file
// tracer cannot see, so `next build` succeeds while the deployed function fails
// with "ERR_DLOPEN_FAILED: libvips-cpp.so... cannot open shared object file".
// This reads the build's trace for /api/upload and fails if any libvips shared
// library installed for this platform is missing from it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const distDir = process.env.NEXT_DIST_DIR || '.next'
const tracePath = join(distDir, 'server/app/api/upload/route.js.nft.json')
if (!existsSync(tracePath)) {
  console.error(`verify-sharp-trace: ${tracePath} not found - run "next build" first.`)
  process.exit(1)
}
const traced = JSON.parse(readFileSync(tracePath, 'utf8')).files

const imgDir = 'node_modules/@img'
const libs = existsSync(imgDir)
  ? readdirSync(imgDir)
      .filter((name) => name.startsWith('sharp-libvips-'))
      .flatMap((name) => {
        const lib = join(imgDir, name, 'lib')
        return existsSync(lib)
          ? readdirSync(lib, { withFileTypes: true })
              .filter((e) => e.isFile() && /\.(so|dylib|dll)/.test(e.name))
              .map((e) => `${name}/lib/${e.name}`)
          : []
      })
  : []

if (libs.length === 0) {
  console.error('verify-sharp-trace: no @img/sharp-libvips-* shared library is installed.')
  process.exit(1)
}
const missing = libs.filter((lib) => !traced.some((f) => f.endsWith(`@img/${lib}`)))
if (missing.length > 0) {
  console.error('verify-sharp-trace: /api/upload trace is missing native libraries:')
  for (const lib of missing) console.error(`  - @img/${lib}`)
  process.exit(1)
}
console.log(`verify-sharp-trace: ok (${libs.join(', ')})`)
