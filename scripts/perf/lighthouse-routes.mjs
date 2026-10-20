#!/usr/bin/env node
/**
 * Repeated Lighthouse runs over a set of routes, reporting the median of each metric.
 *
 *   LIGHTHOUSE_BIN=/path/to/node_modules/.bin/lighthouse \
 *   node scripts/perf/lighthouse-routes.mjs --base http://localhost:3310 --runs 5 \
 *     --out docs/performance/trading-challenge/evidence/after-local.json \
 *     / /about /category/news /articles/some-slug
 *
 * Add --compare <url> --compare-out <file> to measure a second build in the same
 * session, alternating run by run (recommended on a shared machine).
 *
 * Lighthouse is deliberately not a project dependency: install it anywhere (for example
 * `npm i lighthouse@12` in a scratch directory) and point LIGHTHOUSE_BIN at it.
 *
 * Every run blocks the site's analytics endpoints, so pointing this at production
 * cannot increment view counts or create engagement sessions.
 *
 * Defaults are Lighthouse's own mobile profile (simulated throttling: 4x CPU slowdown,
 * ~1.6 Mbps / 150 ms RTT "slow 4G", Moto G Power-sized viewport). Pass --desktop for
 * the desktop preset and --throttling devtools to apply the throttling during a real
 * load instead of simulating it. Keep the profile identical between before and after runs.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const [value] = args.splice(i, 2).slice(1)
  return value
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}

const base = opt('base')
// --compare <url> --compare-out <file>: measure a second server in the same session,
// alternating A and B run by run, so both builds see the same machine conditions.
const compareBase = opt('compare')
const compareOut = opt('compare-out')
const compareLabel = opt('compare-label', '')
const runs = Number(opt('runs', '5'))
const out = opt('out')
const label = opt('label', '')
const desktop = flag('desktop')
// 'simulate' (Lighthouse default: an unthrottled load replayed through a network/CPU model)
// or 'devtools' (throttling applied in the browser while the page actually loads).
const throttling = opt('throttling', 'simulate')
const routes = args
const bin = process.env.LIGHTHOUSE_BIN ?? 'lighthouse'

if (!base || routes.length === 0) {
  console.error('usage: lighthouse-routes.mjs --base <url> [--runs n] [--out file] [--desktop] <route...>')
  process.exit(2)
}

const BLOCKED = ['*/api/analytics/*', '*/api/reading-progress*']

const median = (values) => {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function runOnce(url) {
  const dir = mkdtempSync(join(tmpdir(), 'lh-'))
  const file = join(dir, 'report.json')
  const flags = [
    url,
    '--quiet',
    '--output=json',
    `--output-path=${file}`,
    '--only-categories=performance',
    '--chrome-flags=--headless=new --no-first-run --disable-extensions',
    ...BLOCKED.map((p) => `--blocked-url-patterns=${p}`),
    ...(desktop ? ['--preset=desktop'] : []),
    `--throttling-method=${throttling}`,
  ]
  execFileSync(bin, flags, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180_000 })
  const lhr = JSON.parse(readFileSync(file, 'utf8'))
  rmSync(dir, { recursive: true, force: true })
  const a = lhr.audits
  const summary = a['resource-summary']?.details?.items ?? []
  const bytes = (type) => summary.find((i) => i.resourceType === type)?.transferSize ?? null
  const lcpItem = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node
  return {
    score: Math.round((lhr.categories.performance.score ?? 0) * 100),
    fcp: a['first-contentful-paint'].numericValue,
    lcp: a['largest-contentful-paint'].numericValue,
    tbt: a['total-blocking-time'].numericValue,
    cls: a['cumulative-layout-shift'].numericValue,
    si: a['speed-index'].numericValue,
    ttfb: a['server-response-time']?.numericValue ?? null,
    mainThreadMs: a['mainthread-work-breakdown']?.numericValue ?? null,
    bootupMs: a['bootup-time']?.numericValue ?? null,
    jsTransfer: bytes('script'),
    fontTransfer: bytes('font'),
    imageTransfer: bytes('image'),
    totalTransfer: bytes('total'),
    requests: summary.find((i) => i.resourceType === 'total')?.requestCount ?? null,
    lcpElement: lcpItem?.snippet ?? null,
    lighthouseVersion: lhr.lighthouseVersion,
    formFactor: lhr.configSettings.formFactor,
    throttling: lhr.configSettings.throttling,
  }
}

const keys = ['score', 'fcp', 'lcp', 'tbt', 'cls', 'si', 'ttfb', 'mainThreadMs', 'bootupMs', 'jsTransfer', 'fontTransfer', 'imageTransfer', 'totalTransfer', 'requests']
const summarise = (samples) => ({
  runs: samples.length,
  median: Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]))])),
  lcpElements: [...new Set(samples.map((s) => s.lcpElement))],
  samples: samples.map(({ throttling, lighthouseVersion, formFactor, ...rest }) => rest),
})
const measure = (origin, route, i, tag) => {
  try {
    const sample = runOnce(new URL(route, origin).toString())
    process.stderr.write(`${tag}${route} run ${i + 1}/${runs}: score ${sample.score}, LCP ${Math.round(sample.lcp)}ms\n`)
    return sample
  } catch (error) {
    process.stderr.write(`${tag}${route} run ${i + 1}/${runs} failed: ${error.message}\n`)
    return null
  }
}

const results = {}
const compareResults = {}
for (const route of routes) {
  const a = []
  const b = []
  for (let i = 0; i < runs; i++) {
    // Alternate which server goes first so neither always benefits from a warm machine.
    const order = compareBase && i % 2 ? ['B', 'A'] : ['A', 'B']
    for (const which of order) {
      if (which === 'A') { const s = measure(base, route, i, compareBase ? '[A] ' : ''); if (s) a.push(s) }
      else if (compareBase) { const s = measure(compareBase, route, i, '[B] '); if (s) b.push(s) }
    }
  }
  results[route] = summarise(a)
  if (compareBase) compareResults[route] = summarise(b)
}

const report = {
  label,
  base,
  ...(compareBase ? { pairedWith: compareBase, interleaved: true } : {}),
  generatedAt: new Date().toISOString(),
  runsPerRoute: runs,
  preset: desktop ? 'desktop' : 'mobile (Lighthouse default)',
  throttlingMethod: throttling,
  blockedUrlPatterns: BLOCKED,
  results,
}
if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
}
if (compareBase && compareOut) {
  mkdirSync(dirname(compareOut), { recursive: true })
  const paired = { ...report, label: compareLabel, base: compareBase, pairedWith: base, results: compareResults }
  writeFileSync(compareOut, JSON.stringify(paired, null, 2) + '\n')
}
for (const [route, r] of Object.entries(results)) {
  const m = r.median
  console.log(
    `${route.padEnd(48)} score ${m.score}  FCP ${Math.round(m.fcp)}  LCP ${Math.round(m.lcp)}  TBT ${Math.round(m.tbt)}  CLS ${m.cls?.toFixed(3)}  JS ${Math.round((m.jsTransfer ?? 0) / 1024)}KB`,
  )
}
