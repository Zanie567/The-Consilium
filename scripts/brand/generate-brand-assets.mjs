#!/usr/bin/env node
/**
 * Regenerates The Consilium's static brand assets from the one approved source:
 * the navy-and-gold emblem at src/app/icon.png.
 *
 *   public/og/consilium-share-v2.png   1200×630 default social-sharing image
 *   public/brand/consilium-mark-v2.png  512×512 square brand mark (the emblem, unchanged)
 *   public/logo.png                     the same bytes as the brand mark: kept only because
 *                                       old links and external caches still request it
 *
 * The share image is laid out in HTML and rendered by Playwright's Chromium (already a dev
 * dependency) so the wordmark is set in the site's real typefaces, Playfair Display and
 * Inter, fetched from Google Fonts at generation time. Sharp then downsamples the 2× render
 * and writes the final PNG. Nothing here runs at build or request time: the outputs are
 * committed, and the paths and dimensions they must match live in src/lib/brand.ts.
 *
 * Usage: node scripts/brand/generate-brand-assets.mjs
 * A new design gets a new versioned path (…-v3.png), never an overwrite: social platforms
 * cache images by URL, so a changed file at an old URL can stay stale for weeks.
 */
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EMBLEM = path.join(ROOT, 'src/app/icon.png')
const SHARE_OUT = path.join(ROOT, 'public/og/consilium-share-v2.png')
const MARK_OUT = path.join(ROOT, 'public/brand/consilium-mark-v2.png')
const LOGO_OUT = path.join(ROOT, 'public/logo.png')

const WIDTH = 1200
const HEIGHT = 630
const SCALE = 2

// src/app/globals.css: --color-navy, --color-navy-light, --color-gold, --color-cream
const NAVY = '#1a2744'
const NAVY_LIGHT = '#243460'
const GOLD = '#c9a227'
const CREAM = '#faf8f3'

// The homepage masthead, recomposed for a 1.91:1 card: emblem, wordmark, gold rule, motto,
// society line. A single centred column keeps the emblem in the middle of any square
// centre-crop a platform applies to the thumbnail.
const html = (emblemDataUrl) => `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@600&family=Playfair+Display:ital,wght@0,700;1,400&display=block">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: ${NAVY};
    color: ${CREAM};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative;
  }
  .dots {
    position: absolute; inset: 0; opacity: 0.05;
    background-image: radial-gradient(circle at 1px 1px, ${GOLD} 1px, transparent 0);
    background-size: 28px 28px;
  }
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 60% 75% at 50% 40%, ${NAVY_LIGHT}, transparent 72%);
  }
  .frame { position: absolute; inset: 26px; border: 1px solid rgba(201,162,39,0.28); }
  .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; background: ${GOLD}; }
  .stack { position: relative; display: flex; flex-direction: column; align-items: center; margin-top: -8px; }
  .emblem { width: 212px; height: 212px; display: block; filter: drop-shadow(0 6px 18px rgba(0,0,0,0.35)); }
  .wordmark {
    margin-top: 30px;
    font-family: 'Playfair Display', serif; font-weight: 700;
    font-size: 84px; line-height: 1; letter-spacing: 0.08em; text-transform: uppercase;
    color: ${GOLD};
    padding-left: 0.08em; /* balance the trailing letter-spacing so the word centres optically */
  }
  .rule {
    margin-top: 22px; width: 132px; height: 1px;
    background: linear-gradient(to right, transparent, ${GOLD}, transparent);
  }
  .motto {
    margin-top: 18px;
    font-family: 'Playfair Display', serif; font-style: italic; font-weight: 400;
    font-size: 30px; letter-spacing: 0.04em; color: rgba(250,248,243,0.82);
  }
  .society {
    margin-top: 16px;
    font-family: 'Inter', sans-serif; font-weight: 600;
    font-size: 17px; letter-spacing: 0.3em; text-transform: uppercase;
    color: rgba(201,162,39,0.78);
    padding-left: 0.3em;
  }
</style></head>
<body>
  <div class="dots"></div><div class="glow"></div><div class="frame"></div><div class="stripe"></div>
  <div class="stack">
    <img class="emblem" src="${emblemDataUrl}" alt="">
    <div class="wordmark">The Consilium</div>
    <div class="rule"></div>
    <div class="motto">Ratione et Consilio</div>
    <div class="society">University of Edinburgh Economics Society</div>
  </div>
</body></html>`

async function renderShareImage() {
  const emblem = await fs.readFile(EMBLEM)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE })
    await page.setContent(html(`data:image/png;base64,${emblem.toString('base64')}`), { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    // Refuse to write a share image set in a fallback face.
    const missing = await page.evaluate(() =>
      ['700 84px "Playfair Display"', 'italic 400 30px "Playfair Display"', '600 17px "Inter"'].filter(
        (font) => !document.fonts.check(font)
      )
    )
    if (missing.length) throw new Error(`fonts did not load: ${missing.join(', ')}`)
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length)
    if (loaded < 3) throw new Error(`expected 3 loaded font faces, got ${loaded}`)
    return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
  } finally {
    await browser.close()
  }
}

const raw = await renderShareImage()
await fs.mkdir(path.dirname(SHARE_OUT), { recursive: true })
await sharp(raw)
  .resize(WIDTH, HEIGHT, { kernel: 'lanczos3' })
  .removeAlpha()
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(SHARE_OUT)

// The square mark is the approved emblem byte for byte; re-encoding it would only risk drift.
await fs.mkdir(path.dirname(MARK_OUT), { recursive: true })
await fs.copyFile(EMBLEM, MARK_OUT)
await fs.copyFile(EMBLEM, LOGO_OUT)

for (const file of [SHARE_OUT, MARK_OUT, LOGO_OUT]) {
  const { width, height, format } = await sharp(file).metadata()
  const { size } = await fs.stat(file)
  console.log(`${path.relative(ROOT, file)}  ${format} ${width}×${height}  ${(size / 1024).toFixed(0)} KB`)
}
