#!/usr/bin/env node
/**
 * Redraws the trading dates on the Trading Challenge share card.
 *
 *   in:  public/og/trading-challenge.png     the approved campaign card (dates 28 Oct – 25 Mar)
 *   out: public/og/trading-challenge-v2.png  the same card with the dates from src/lib/tradingChallenge.ts
 *
 * Only the "TRADING" value and the gold rule above it change; every other pixel is copied
 * from the approved card. The value is set in Playfair Display 700 with lining figures at
 * 30px (fitted against the approved card; `--check` proves the fit), rendered at 2× by
 * Playwright's Chromium and downsampled by Sharp, as in generate-brand-assets.mjs. The rule
 * is as wide as the value, as on the original card. Needs network once, for Google Fonts.
 *
 * Usage:
 *   node scripts/brand/generate-trading-card.mjs           write the v2 card
 *   node scripts/brand/generate-trading-card.mjs --check   redraw the ORIGINAL dates and compare
 *                                                          with the approved card (no file written)
 *
 * If the dates change again, bump OUT to a new path (…-v3.png) and update SHARE_IMAGE in
 * src/app/trading-challenge/page.tsx: platforms cache share images by URL.
 */
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = path.join(ROOT, 'public/og/trading-challenge.png')
const OUT = path.join(ROOT, 'public/og/trading-challenge-v2.png')
const CONFIG = path.join(ROOT, 'src/lib/tradingChallenge.ts')

const WIDTH = 1200
const HEIGHT = 630
const SCALE = 2
const NAVY = [26, 39, 68] // #1a2744, the card background
const CREAM = '#faf8f3'

// Geometry of the TRADING column on the approved card (1× pixels).
const TEXT = { left: 376, top: 523.5, size: 30 }
const RULE = { rows: [480, 481, 482], left: 376, right: 593, sampleX: 400 } // the old rule, and a clean column of it
const OLD_TEXT = { left: 372, top: 522, right: 599, bottom: 556 } // old value's ink, with a margin
const PATCH = { left: 366, top: 515, right: 720, bottom: 600 } // the value may extend into this area only
// The card's faint background grid: lines every 48px, a few levels above navy.
const GRID = 48

const check = process.argv.includes('--check')

const short = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

async function datesLabel() {
  if (check) return '28 Oct – 25 Mar'
  const src = await fs.readFile(CONFIG, 'utf8')
  const start = src.match(/startDate:\s*'(\d{4}-\d{2}-\d{2})'/)?.[1]
  const end = src.match(/endDate:\s*'(\d{4}-\d{2}-\d{2})'/)?.[1]
  if (!start || !end) throw new Error('could not read startDate/endDate from tradingChallenge.ts')
  return `${short(start)} – ${short(end)}`
}

/** The value alone on a transparent page, downsampled to 1×; returns raw RGBA. */
async function renderValue(label) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE })
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=block">
<style>*{margin:0;padding:0}html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:transparent}
#v{position:absolute;left:${TEXT.left}px;top:${TEXT.top}px;font:700 ${TEXT.size}px 'Playfair Display';font-variant-numeric:lining-nums;line-height:1;color:${CREAM};white-space:nowrap}</style>
</head><body><div id="v"></div></body></html>`,
      { waitUntil: 'networkidle' },
    )
    await page.evaluate((text) => (document.getElementById('v').textContent = text), label)
    await page.evaluate(() => document.fonts.ready)
    if (!(await page.evaluate(() => document.fonts.check(`700 30px "Playfair Display"`)))) {
      throw new Error('Playfair Display did not load; refusing to draw in a fallback face')
    }
    const shot = await page.screenshot({ type: 'png', omitBackground: true })
    const oneX = await sharp(shot).resize(WIDTH, HEIGHT, { kernel: 'lanczos3' }).ensureAlpha().png().toBuffer()
    return sharp(oneX).raw().toBuffer()
  } finally {
    await browser.close()
  }
}

const label = await datesLabel()
const base = await sharp(SOURCE).removeAlpha().raw().toBuffer()
const value = await renderValue(label)
const at = (x, y) => (y * WIDTH + x) * 3
const offNavy = (buf, i) => Math.abs(buf[i] - NAVY[0]) + Math.abs(buf[i + 1] - NAVY[1]) + Math.abs(buf[i + 2] - NAVY[2])

// 1. A clean background: remove the old value and rule, keeping the grid. Masked pixels on a
//    grid line are interpolated along the line from its nearest unmasked pixels; the rest are navy.
const bg = Buffer.from(base)
const masked = (x, y) =>
  (x >= OLD_TEXT.left && x <= OLD_TEXT.right && y >= OLD_TEXT.top && y <= OLD_TEXT.bottom) ||
  (RULE.rows.includes(y) && x >= RULE.left - 1 && x <= RULE.right + 1)
const along = (x, y, dx, dy) => {
  let a = [x, y]
  let b = [x, y]
  while (masked(...a)) a = [a[0] - dx, a[1] - dy]
  while (masked(...b)) b = [b[0] + dx, b[1] + dy]
  const span = (b[0] - a[0]) + (b[1] - a[1])
  const t = span ? ((x - a[0]) + (y - a[1])) / span : 0
  const ia = at(...a)
  const ib = at(...b)
  return [0, 1, 2].map((c) => Math.round(base[ia + c] * (1 - t) + base[ib + c] * t))
}
for (let y = PATCH.top - 40; y < PATCH.bottom; y++) {
  for (let x = PATCH.left; x < PATCH.right; x++) {
    if (!masked(x, y)) continue
    const onCol = x % GRID === 0
    const onRow = y % GRID === 0
    bg.set(onCol && !onRow ? along(x, y, 0, 1) : onRow ? along(x, y, 1, 0) : NAVY, at(x, y))
  }
}

// 2. The new value's extent, which sets the rule's width.
let inkRight = -1
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    if (value[(y * WIDTH + x) * 4 + 3] > 24) {
      if (x < PATCH.left || x >= PATCH.right - 4 || y < PATCH.top || y >= PATCH.bottom) throw new Error(`value does not fit its area (pixel ${x},${y})`)
      inkRight = Math.max(inkRight, x)
    }
  }
}
if (inkRight < 0) throw new Error('nothing was drawn')

// 3. Composite: the rule at the new width, then the value over the clean background.
const out = Buffer.from(bg)
for (const y of RULE.rows) {
  for (let x = RULE.left; x < inkRight; x++) base.copy(out, at(x, y), at(RULE.sampleX, y), at(RULE.sampleX, y) + 3)
}
for (let p = 0; p < WIDTH * HEIGHT; p++) {
  const a = value[p * 4 + 3] / 255
  if (!a) continue
  for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.round(value[p * 4 + c] * a + out[p * 3 + c] * (1 - a))
}

if (check) {
  let sum = 0
  let max = 0
  let gridLost = 0
  for (let i = 0; i < out.length; i++) {
    const d = Math.abs(out[i] - base[i])
    sum += d
    max = Math.max(max, d)
  }
  // Grid pixels outside the old ink must survive exactly.
  for (let y = PATCH.top; y < PATCH.bottom; y++) {
    for (let x = PATCH.left; x < PATCH.right; x++) {
      if (!masked(x, y) && offNavy(base, at(x, y)) > 0 && offNavy(out, at(x, y)) === 0) gridLost++
    }
  }
  const mean = sum / out.length
  if (process.env.CHECK_OUT) await sharp(out, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(process.env.CHECK_OUT)
  console.log(`check: redrew "${label}" over the approved card; mean channel difference ${mean.toFixed(4)}, max ${max}, grid pixels lost ${gridLost}`)
  process.exit(mean < 0.05 && gridLost === 0 ? 0 : 1)
}

await sharp(out, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(OUT)
const { width, height, format } = await sharp(OUT).metadata()
const { size } = await fs.stat(OUT)
console.log(`${path.relative(ROOT, OUT)}  "${label}"  ${format} ${width}×${height}  ${(size / 1024).toFixed(0)} KB`)
