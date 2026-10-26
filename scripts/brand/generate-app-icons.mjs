#!/usr/bin/env node
/**
 * Regenerates the site's favicons and app icons from the approved emblem
 * (public/brand/consilium-mark-v2.png, a gold-ringed navy medallion on a transparent square).
 *
 * Every output is an opaque square of the medallion's own navy with the emblem centred.
 * Opaque matters: the emblem's transparent corners are what iOS filled with white on the home
 * screen, and what Google and Android launchers showed on their own light backgrounds.
 *
 *   src/app/favicon.ico            16, 32, 48   browser tabs, /favicon.ico requests
 *   src/app/icon1.png              32           <link rel="icon"> (Next adds a content hash)
 *   src/app/icon2.png              192          high-DPI tabs, search results (multiple of 48)
 *   src/app/apple-icon.png         180          iOS "Add to Home Screen"
 *   public/apple-touch-icon.png    180          same bytes, for clients that guess the path
 *   public/brand/app-icon-192-v1.png, app-icon-512-v1.png             manifest "any"
 *   public/brand/app-icon-maskable-512-v1.png                          manifest "maskable"
 *
 * Usage: node scripts/brand/generate-app-icons.mjs
 * A new design gets new versioned manifest paths (…-v2.png); the Next icon files are hashed
 * by Next itself, so they can keep their names.
 */
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EMBLEM = path.join(ROOT, 'public/brand/consilium-mark-v2.png')

/** The navy inside the emblem's ring, so the medallion meets the background without a seam. */
export const ICON_NAVY = '#14213e'

// How much of the square the medallion's diameter fills.
const SCALE_LARGE = 0.86 // ring clear of iOS/Android corner rounding
const SCALE_MASKABLE = 0.76 // inside the 80% safe circle launchers may crop to
const SCALE_SMALL = 1.0 // tabs: every pixel counts, ring runs to the edge

// The emblem's hairline gold strokes vanish into the navy at tab sizes, so the small icons are
// cut from a copy whose strokes are thickened at full resolution first.
const SMALL_STROKE_RADIUS = 4 // px at 512

/** Max-luminance filter over a disc: each pixel takes its brightest neighbour, widening gold lines. */
async function thickened(radius) {
  const { data, info } = await sharp(EMBLEM).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const lum = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    lum[i] = (data[i * 4 + 3] / 255) * (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2])
  }
  const disc = []
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) disc.push([dx, dy])
  const out = Buffer.from(data)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let best = -1, src = y * W + x, alpha = 0
      for (const [dx, dy] of disc) {
        const X = x + dx, Y = y + dy
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        const j = Y * W + X
        if (lum[j] > best) { best = lum[j]; src = j }
        if (data[j * 4 + 3] > alpha) alpha = data[j * 4 + 3]
      }
      const o = (y * W + x) * 4
      out[o] = data[src * 4]; out[o + 1] = data[src * 4 + 1]; out[o + 2] = data[src * 4 + 2]; out[o + 3] = alpha
    }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
}
const SMALL_SOURCE = await thickened(SMALL_STROKE_RADIUS)

async function render(size, scale) {
  const inner = Math.round(size * scale)
  const emblem = await sharp(size <= 48 ? SMALL_SOURCE : EMBLEM)
    .resize(inner, inner, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const offset = Math.round((size - inner) / 2)
  return sharp({ create: { width: size, height: size, channels: 3, background: ICON_NAVY } })
    .composite([{ input: emblem, left: offset, top: offset }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** A .ico container holding PNG frames (supported by every current browser). */
function ico(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  const dir = Buffer.alloc(16 * frames.length)
  let offset = 6 + dir.length
  frames.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...frames.map((f) => f.data)])
}

const out = (p) => path.join(ROOT, p)
const write = async (p, data) => {
  await fs.mkdir(path.dirname(out(p)), { recursive: true })
  await fs.writeFile(out(p), data)
  const { width, height, hasAlpha } = await sharp(data).metadata().catch(() => ({}))
  console.log(`${p}  ${width ? `${width}×${height}${hasAlpha ? ' (alpha!)' : ''}` : `${data.length} bytes`}`)
}

const icoFrames = []
for (const size of [16, 32, 48]) icoFrames.push({ size, data: await render(size, SCALE_SMALL) })
await write('src/app/favicon.ico', ico(icoFrames))
await write('src/app/icon1.png', await render(32, SCALE_SMALL))
await write('src/app/icon2.png', await render(192, SCALE_LARGE))
const apple = await render(180, SCALE_LARGE)
await write('src/app/apple-icon.png', apple)
await write('public/apple-touch-icon.png', apple)
await write('public/brand/app-icon-192-v1.png', await render(192, SCALE_LARGE))
await write('public/brand/app-icon-512-v1.png', await render(512, SCALE_LARGE))
await write('public/brand/app-icon-maskable-512-v1.png', await render(512, SCALE_MASKABLE))
