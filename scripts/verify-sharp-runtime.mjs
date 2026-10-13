// Runtime proof for the /api/upload function package.
//
// Copies ONLY the files Next's trace lists for /api/upload into an empty
// directory outside the repo (so the repo's full node_modules cannot satisfy any
// lookup), then loads sharp from that copy in a fresh process with a minimal
// environment and runs the same operations the route performs on a real JPEG.
// A negative control repeats the run without the libvips shared library and must
// fail, which proves this check is sensitive to the production fault.
//
//   node scripts/verify-sharp-runtime.mjs            # after `next build`
//   REQUIRE_LINUX_X64=1 ...                          # CI: refuse to run elsewhere
import { spawnSync } from 'node:child_process'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

if (process.env.REQUIRE_LINUX_X64 === '1' && !(process.platform === 'linux' && process.arch === 'x64')) {
  console.error(`verify-sharp-runtime: expected linux/x64, got ${process.platform}/${process.arch}`)
  process.exit(1)
}

const root = process.cwd()
const distDir = resolve(root, process.env.NEXT_DIST_DIR || '.next')
const traceDir = join(distDir, 'server/app/api/upload')
const traced = JSON.parse(readFileSync(join(traceDir, 'route.js.nft.json'), 'utf8')).files
const fixture = resolve(root, 'public/team/yaoqing-wang.jpeg') // a real photograph
if (!existsSync(fixture)) throw new Error(`fixture missing: ${fixture}`)

const isNativeLib = (p) => /sharp-libvips-[^/]+\/lib\/.*\.(so|dylib|dll)/.test(p)

function buildPackage(dir, { withoutLibvips }) {
  let copied = 0
  for (const rel of traced) {
    const src = resolve(traceDir, rel)
    if (withoutLibvips && isNativeLib(src)) continue
    if (!src.startsWith(root + '/')) throw new Error(`traced file outside project: ${src}`)
    const dest = join(dir, src.slice(root.length + 1))
    mkdirSync(dirname(dest), { recursive: true })
    const stat = lstatSync(src)
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(src), dest)
    else copyFileSync(src, dest)
    copied++
  }
  return copied
}

// How the compiled route loads sharp: via the hashed alias Next creates under
// .next/node_modules. Fall back to the package name if there is none.
const alias = traced.map((p) => resolve(traceDir, p)).find((p) => /\/node_modules\/sharp-[0-9a-f]{8,}$/.test(p))
const sharpSpecifier = alias ? './' + alias.slice(root.length + 1) : 'sharp'

const probe = `
const sharp = require(${JSON.stringify(sharpSpecifier)})
const fs = require('node:fs')
;(async () => {
  // sharp silently falls back to WebAssembly when the native binding fails; that
  // is not what we want to ship, so require the platform-native binary.
  const loaded = Object.keys(require.cache)
  if (loaded.some((k) => k.includes('sharp-wasm32'))) throw new Error('sharp fell back to wasm32: native binding did not load')
  if (!loaded.some((k) => /sharp-(linux|darwin|win32)[^/]*\\/lib\\/.+\\.node$/.test(k))) throw new Error('native sharp binding not loaded')
  const jpeg = fs.readFileSync(process.argv[2])
  const opts = { limitInputPixels: 40_000_000, failOn: 'error' }
  // Exactly what the upload route does to validate an article image.
  const image = sharp(jpeg, opts)
  const meta = await image.metadata()
  await image.resize(1, 1).toBuffer()
  if (!meta.width || !meta.height || meta.format !== 'jpeg') throw new Error('bad metadata ' + JSON.stringify(meta))
  // Every format the route accepts: encode from the real photo, then decode it back.
  for (const fmt of ['png', 'webp', 'gif', 'avif', 'jpeg']) {
    const out = await sharp(jpeg).resize(64).toFormat(fmt).toBuffer()
    const back = await sharp(out, opts).metadata()
    await sharp(out, opts).resize(1, 1).toBuffer()
    const expected = fmt === 'avif' ? 'heif' : fmt // sharp reports AVIF containers as "heif"
    if (back.format !== expected) {
      throw new Error('round trip failed for ' + fmt + ': got ' + back.format)
    }
  }
  console.log('sharp ' + sharp.versions.sharp + ' libvips ' + sharp.versions.vips + ' decoded ' + meta.width + 'x' + meta.height + ' jpeg; png/webp/gif/avif/jpeg round-trip ok')
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(3) })
`

function run(label, withoutLibvips) {
  const dir = mkdtempSync(join(tmpdir(), 'sharp-fn-'))
  try {
    const n = buildPackage(dir, { withoutLibvips })
    writeFileSync(join(dir, 'probe.cjs'), probe)
    const res = spawnSync(process.execPath, ['probe.cjs', fixture], {
      cwd: dir,
      env: { PATH: dirname(process.execPath), HOME: dir }, // no NODE_PATH, no LD_LIBRARY_PATH
      encoding: 'utf8',
    })
    console.log(`[${label}] packaged ${n} traced files; exit ${res.status}`)
    return res
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const ok = run('deployment package', false)
if (ok.status !== 0) {
  console.error(ok.stderr || ok.stdout)
  console.error('verify-sharp-runtime: FAILED - sharp does not work from the traced package.')
  process.exit(1)
}
console.log(ok.stdout.trim())

const control = run('negative control (libvips removed)', true)
if (control.status === 0) {
  console.error('verify-sharp-runtime: FAILED - the control still loaded sharp, so this check proves nothing.')
  process.exit(1)
}
if (!/libvips|dlopen|wasm32|native sharp binding|Could not load the "sharp"/i.test(control.stderr)) {
  console.error('verify-sharp-runtime: control failed for an unexpected reason:\n' + control.stderr)
  process.exit(1)
}
console.log('negative control failed as expected: ' + control.stderr.split('\n').find((l) => /sharp|libvips/i.test(l)))
console.log('verify-sharp-runtime: ok')
