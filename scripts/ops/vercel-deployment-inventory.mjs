// READ-ONLY inventory of a Vercel project's retained deployments, classified for cleanup.
//
// It never deletes anything. It writes, to --out (default: a new directory under the OS temp dir):
//   inventory.json      every deployment with its class and the reason
//   remove-candidates.sh  `vercel remove` lines for SAFE candidates only, every line commented out,
//                       for the owner to review and run by hand after approval
//
//   node scripts/ops/vercel-deployment-inventory.mjs \
//     --project the-consilium --scope zanie567s-projects --repo Zanie567/The-Consilium [--out DIR]
//
// Needs the Vercel CLI (`vercel login`) and the GitHub CLI (`gh auth login`). Classes:
//   PROTECTED  current production; the KEEP_PRODUCTION newest READY production deployments
//              (rollback history); the newest READY preview of each branch with an OPEN pull
//              request; the 3 newest deployments (Vercel always keeps them); anything still building
//   REVIEW     older previews of branches with an open pull request
//   SAFE       superseded production, previews of merged/closed/deleted branches or of branches
//              without a pull request, and ERROR/CANCELED deployments
// Vercel stores function bundles only for READY deployments, so SAFE READY rows free Functions
// Storage; ERROR/CANCELED rows are listed for tidiness.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const KEEP_PRODUCTION = 5
const VERCEL_ALWAYS_KEEPS_NEWEST = 3

/**
 * @param {Array<object>} deployments  Vercel /v6/deployments rows
 * @param {{ openPrBranches: Set<string> }} github
 */
export function classify(deployments, { openPrBranches }, { keepProduction = KEEP_PRODUCTION } = {}) {
  const byNewest = [...deployments].sort((a, b) => b.created - a.created)
  const productionReady = byNewest.filter((d) => d.target === 'production' && d.state === 'READY')
  const current = productionReady[0]?.uid
  const rollback = new Set(productionReady.slice(0, keepProduction).map((d) => d.uid))
  const newest = new Set(byNewest.slice(0, VERCEL_ALWAYS_KEEPS_NEWEST).map((d) => d.uid))
  const latestPreview = new Map()
  for (const d of byNewest) {
    const branch = d.meta?.githubCommitRef
    if (d.target !== 'production' && d.state === 'READY' && branch && !latestPreview.has(branch)) latestPreview.set(branch, d.uid)
  }

  return byNewest.map((d) => {
    const branch = d.meta?.githubCommitRef ?? null
    const target = d.target === 'production' ? 'production' : 'preview'
    const protectedBy = []
    if (d.uid === current) protectedBy.push('current production')
    else if (rollback.has(d.uid)) protectedBy.push(`one of the ${keepProduction} newest production deployments`)
    if (newest.has(d.uid)) protectedBy.push('one of the 3 newest deployments')
    if (target === 'preview' && branch && openPrBranches.has(branch) && latestPreview.get(branch) === d.uid) protectedBy.push('newest preview of an open pull request')
    if (['BUILDING', 'INITIALIZING', 'QUEUED'].includes(d.state)) protectedBy.push(`still ${d.state.toLowerCase()}`)

    let cls; let reason
    if (protectedBy.length) { cls = 'PROTECTED'; reason = protectedBy.join('; ') }
    else if (target === 'preview' && branch && openPrBranches.has(branch)) { cls = 'REVIEW'; reason = 'older preview of an open pull request' }
    else if (d.state === 'ERROR' || d.state === 'CANCELED') { cls = 'SAFE'; reason = `${d.state.toLowerCase()} build (no functions stored)` }
    else if (target === 'production') { cls = 'SAFE'; reason = 'superseded production deployment' }
    else { cls = 'SAFE'; reason = branch ? 'preview of a branch without an open pull request' : 'preview without a branch' }

    return {
      uid: d.uid, url: d.url, created: new Date(d.created).toISOString(), target, state: d.state,
      branch, sha: (d.meta?.githubCommitSha ?? '').slice(0, 7), class: cls, reason,
    }
  })
}

export function summarise(rows) {
  const out = {}
  for (const r of rows) {
    const key = `${r.class} ${r.target} ${r.state}`
    out[key] = (out[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort())
}

function parseConcatenatedJson(text) {
  const out = []; let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    let depth = 0; let inString = false; let j = i
    for (; j < text.length; j++) {
      const c = text[j]
      if (inString) { if (c === '\\') j++; else if (c === '"') inString = false; continue }
      if (c === '"') inString = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') { depth--; if (depth === 0) { j++; break } }
    }
    out.push(JSON.parse(text.slice(i, j))); i = j
  }
  return out
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith('--') ? [...acc, [arg.slice(2), all[i + 1]]] : acc), []))
  const { project, scope, repo } = args
  if (!project || !scope || !repo) {
    console.error('usage: --project <name> --scope <team-slug> --repo <owner/name> [--out DIR]')
    process.exit(2)
  }
  const run = (cmd, argv) => execFileSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] })
  const projectInfo = JSON.parse(run('vercel', ['api', `/v9/projects/${encodeURIComponent(project)}?slug=${encodeURIComponent(scope)}`, '--raw']))
  const pages = parseConcatenatedJson(run('vercel', ['api', `/v6/deployments?projectId=${projectInfo.id}&slug=${encodeURIComponent(scope)}&limit=100`, '--paginate', '--raw']))
  const deployments = pages.flatMap((p) => (Array.isArray(p) ? p : p.deployments ?? []))
  const prs = JSON.parse(run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'headRefName']))
  const rows = classify(deployments, { openPrBranches: new Set(prs.map((p) => p.headRefName)) })

  const out = args.out ?? mkdtempSync(join(tmpdir(), `vercel-inventory-${project}-`))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'inventory.json'), JSON.stringify({ project, retention: projectInfo.deploymentExpiration, generatedAt: new Date().toISOString(), rows }, null, 1))
  const safe = rows.filter((r) => r.class === 'SAFE')
  writeFileSync(join(out, 'remove-candidates.sh'), [
    '#!/usr/bin/env bash',
    `# ${safe.length} SAFE candidates for ${project}, generated ${new Date().toISOString()}.`,
    '# Nothing here runs until you uncomment it. Re-run the inventory first if this file is old:',
    '# deployments, pull requests and production change. Deleted deployments can be restored from',
    '# Settings > Security > Recently Deleted during Vercel\'s recovery period.',
    ...safe.map((r) => `# vercel remove ${r.uid} --scope ${scope} --yes   # ${r.target} ${r.state} ${r.branch ?? '-'} ${r.created.slice(0, 10)}: ${r.reason}`),
    '',
  ].join('\n'))
  console.log(JSON.stringify({ project, retention: projectInfo.deploymentExpiration, total: rows.length, summary: summarise(rows), out }, null, 1))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
