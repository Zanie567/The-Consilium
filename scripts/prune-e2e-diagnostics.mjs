// Keeps failure diagnostics under a size budget before they are uploaded as a CI
// artifact, so one bad run cannot store hundreds of MB.
//
//   node scripts/prune-e2e-diagnostics.mjs [--max-mb 100] [--dry-run] <dir>...
//
// Removal order (largest first within each class) until the total fits:
//   1. trace zips (the HTML report's data/ copy is what a reader opens; the
//      test-results copy is a duplicate and is excluded from uploads separately)
//   2. videos
//   3. screenshots
//   4. any other file, except the report index and results.json
// A summary of what was removed is written to ci-diagnostics-summary.txt (uploaded
// with the artifact) so a trimmed artifact is never mistaken for a complete one.
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
let maxMb = 100
let dryRun = false
const dirs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-mb') maxMb = Number(args[++i])
  else if (args[i] === '--dry-run') dryRun = true
  else dirs.push(args[i])
}
if (!Number.isFinite(maxMb) || maxMb <= 0 || dirs.length === 0) {
  console.error('usage: prune-e2e-diagnostics.mjs [--max-mb N] [--dry-run] <dir>...')
  process.exit(2)
}

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const path = join(dir, e.name)
    if (e.isDirectory()) walk(path, out)
    else if (e.isFile()) out.push({ path, size: statSync(path).size })
  }
  return out
}

const files = dirs.flatMap((d) => walk(d))
const budget = maxMb * 1024 * 1024
let total = files.reduce((n, f) => n + f.size, 0)
const mb = (n) => (n / 1048576).toFixed(1)
console.log(`diagnostics: ${files.length} files, ${mb(total)} MB (budget ${maxMb} MB)`)

const isProtected = (p) => /(^|\/)results\.json$/.test(p) || /(^|\/)index\.html$/.test(p)
const rank = (p) =>
  /\.zip$/.test(p) ? 0 : /\.(webm|mp4)$/.test(p) ? 1 : /\.(png|jpe?g)$/.test(p) ? 2 : 3
const candidates = files
  .filter((f) => !isProtected(f.path))
  .sort((a, b) => rank(a.path) - rank(b.path) || b.size - a.size)

const removed = []
for (const f of candidates) {
  if (total <= budget) break
  if (!dryRun) rmSync(f.path, { force: true })
  total -= f.size
  removed.push(f)
}

const lines = [
  `Diagnostics budget: ${maxMb} MB. Final size: ${mb(total)} MB.`,
  removed.length === 0
    ? 'Nothing was removed.'
    : `${dryRun ? 'Would remove' : 'Removed'} ${removed.length} file(s) to fit the budget:`,
  ...removed.map((f) => `  ${mb(f.size).padStart(7)} MB  ${f.path}`),
]
if (!dryRun) writeFileSync('ci-diagnostics-summary.txt', lines.join('\n') + '\n')
console.log(lines.join('\n'))
if (total > budget) {
  console.error(`still over budget (${mb(total)} MB): only protected files remain`)
  process.exit(1)
}
