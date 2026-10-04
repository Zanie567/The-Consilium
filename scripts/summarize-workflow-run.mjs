// Summarise one attested run, never combine successes from different revisions.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const [directory, output, runURL] = process.argv.slice(2)
if (!directory || !output) throw new Error('Usage: node scripts/summarize-workflow-run.mjs <run-directory> <output.json> [GitHub-run-URL]')
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
const attestation = read('commit.json')
const apiOnly = [
  [/wf-roles\.spec/, /sensitive endpoints/],
  [/wf-stale-authorization\.spec/, /./],
  [/network-crawl\.spec/, /./],
  [/team-profile\.spec/, /the API refuses|unauthenticated caller|a (?:admin|reader) account is refused|forged userId|public team API/],
  [/wf-admin-content\.spec/, /a writer cannot create|only an admin may change|a writer and a reader cannot/],
  [/wf-access\.spec/, /nobody below Admin|writer cannot take their own|can neither trash nor restore|writer cannot schedule/],
  [/wf-upload\.spec/, /server enforces|avatar bucket has|signed-out callers|cannot upload article|unknown bucket/],
  [/wf-publication-safety\.spec/, /PUT without|even with the intent flag/],
]
const method = (file, title) => file === 'auth.setup.ts' ? 'BROWSER_FIXTURE_PREPARATION'
  : apiOnly.some(([f, t]) => f.test(file) && t.test(title)) ? 'API_DB'
    : 'BROWSER (see individual steps; API/DB assertions may additionally verify persistence and permissions)'
const phases = []
const attachment = (a, phase) => {
  if (a.path) return { name: a.name, contentType: a.contentType,
    artifactPath: a.path.replace(/^.*?(?=test-results\/)/, '') }
  if (!a.body) return { name: a.name, contentType: a.contentType }
  // Playwright's HTML reporter stores inline attachments by their SHA-1.
  // Reference that retained file without duplicating base64 payloads in the inventory.
  const bytes = Buffer.from(a.body, 'base64')
  const extensions = { 'image/png': 'png', 'application/pdf': 'pdf' }
  const extension = extensions[a.contentType]
  const digest = createHash('sha1').update(bytes).digest('hex')
  return { name: a.name, contentType: a.contentType, bytes: bytes.length,
    ...(extension ? { artifactPath: `playwright-report/${path.basename(directory)}/${phase}/data/${digest}.${extension}` }
      : { artifactPath: `test-results/${path.basename(directory)}/${phase}/results.json`, inlineSHA1: digest }) }
}
for (const phase of ['main', 'workflow', 'team-profile']) {
  const result = read(`${phase}/results.json`)
  const recordedCommit = result.config?.metadata?.gitCommit?.hash
  if (recordedCommit && recordedCommit !== attestation.commit) throw new Error(`Mixed commit in ${phase}`)
  const tests = []
  const visit = (suite, ancestors = []) => {
    const titles = [...ancestors, suite.title].filter(Boolean)
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const title = [...titles, spec.title].join(' > ')
      const file = path.basename(spec.file)
      tests.push({ file, line: spec.line, title, project: test.projectName, method: method(file, title),
        outcome: test.status, expectedStatus: test.expectedStatus,
        executions: test.results.map(r => ({ status: r.status, duration: r.duration, retry: r.retry,
          errors: (r.errors ?? []).map(e => e.message),
          attachments: (r.attachments ?? []).map(a => attachment(a, phase)) })),
      })
    }
    for (const child of suite.suites ?? []) visit(child, titles)
  }
  for (const suite of result.suites) visit(suite)
  phases.push({ phase, stats: result.stats, tests })
}
const vitest = read('vitest.json')
const summary = { exactTestedCommit: attestation.commit, runURL, environment: attestation,
  isolation: read('isolation.json'), cleanup: fs.existsSync(path.join(directory, 'cleanup.json')) ? read('cleanup.json') : 'No explicit post-drop attestation in this historical run',
  scope: 'One full run. Test outcomes are not a count of distinct actions. Browser setup is preparation; API-only checks do not establish UI behaviour. Reviewed action-family expectations are in coverage-inventory.md.',
  vitest: { total: vitest.numTotalTests, passed: vitest.numPassedTests, failed: vitest.numFailedTests, pending: vitest.numPendingTests },
  browser: { passed: phases.reduce((n, p) => n + p.stats.expected, 0), failed: phases.reduce((n, p) => n + p.stats.unexpected, 0),
    skipped: phases.reduce((n, p) => n + p.stats.skipped, 0), flaky: phases.reduce((n, p) => n + p.stats.flaky, 0) }, phases }
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ exactTestedCommit: summary.exactTestedCommit, vitest: summary.vitest, browser: summary.browser }))
