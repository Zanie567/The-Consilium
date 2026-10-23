#!/usr/bin/env node
/**
 * Prints Markdown before/after tables from lighthouse-routes.mjs and initial-js.mjs
 * output, so report numbers are generated rather than transcribed.
 *
 *   node scripts/perf/report-table.mjs <before.json> <after.json> [initial-js-before.json initial-js-after.json] [--extra new-routes.json]
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const extraAt = argv.indexOf('--extra')
const extraPath = extraAt === -1 ? null : argv.splice(extraAt, 2)[1]
const [beforePath, afterPath, jsBeforePath, jsAfterPath] = argv
if (!beforePath || !afterPath) {
  console.error('usage: report-table.mjs <before.json> <after.json> [initial-js-before.json initial-js-after.json]')
  process.exit(2)
}
const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const before = load(beforePath).results
// --extra merges routes measured only on the new build (e.g. a new page) into "after".
const after = { ...load(afterPath).results, ...(extraPath ? load(extraPath).results : {}) }
const jsBefore = jsBeforePath ? load(jsBeforePath).results : {}
const jsAfter = jsAfterPath ? load(jsAfterPath).results : {}

const s = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(2)} s`)
const ms = (v) => (v == null ? '–' : `${Math.round(v)} ms`)
const kb = (b) => (b == null ? '–' : `${(b / 1024).toFixed(0)} KB`)
const pct = (b, a) => (b == null || a == null || b === 0 ? 'new' : `${a < b ? '−' : '+'}${Math.abs(Math.round(((a - b) / b) * 100))}%`)
const label = (r) => (r.startsWith('/articles/') ? 'Article' : r === '/' ? 'Home' : r)

const rows = Object.keys(after)
console.log('| Route | LCP before | LCP after | Δ | FCP before | FCP after | TBT before | TBT after | CLS after | Score before → after | Runs |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  const b = before[r]?.median
  const a = after[r].median
  console.log(
    `| ${label(r)} | ${s(b?.lcp)} | ${s(a.lcp)} | ${pct(b?.lcp, a.lcp)} | ${s(b?.fcp)} | ${s(a.fcp)} | ${ms(b?.tbt)} | ${ms(a.tbt)} | ${a.cls.toFixed(3)} | ${b?.score ?? '–'} → ${a.score} | ${before[r]?.runs ?? 0}/${after[r].runs} |`,
  )
}

if (jsBeforePath) {
  console.log('\n| Route | Initial JS before (gzip) | after | Δ | Fonts transferred before | after |')
  console.log('|---|---|---|---|---|---|')
  for (const r of rows) {
    console.log(
      `| ${label(r)} | ${kb(jsBefore[r]?.gzipBytes)} | ${kb(jsAfter[r]?.gzipBytes)} | ${pct(jsBefore[r]?.gzipBytes, jsAfter[r]?.gzipBytes)} | ${kb(before[r]?.median.fontTransfer)} | ${kb(after[r].median.fontTransfer)} |`,
    )
  }
}
