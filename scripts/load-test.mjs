/** Local-only, attested, bounded HTTP/DB probe. Run via E2E_LOAD_TEST=1 scripts/run-e2e.sh. */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
const require = createRequire(import.meta.url)
require('ts-node').register({ project: 'tsconfig.seed.json', transpileOnly: true })
require('./lib/assertRunDatabase.ts').assertRunDatabase()
require('./lib/testServices.ts').assertIsolatedServiceEnv()
const base = new URL(process.env.E2E_BASE_URL)
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('Local HTTP only')
const isolation = JSON.parse(fs.readFileSync(`${process.env.E2E_RESULTS_DIR}/isolation.json`))
if (isolation.app.run !== process.env.E2E_RUN_ID) throw Error('Missing run attestation')
const profile = process.env.E2E_LOAD_PROFILE ?? 'mixed'
if (!['mixed', 'analytics'].includes(profile)) throw Error('Unknown local load profile')
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
await db.connect()
const report = { run: process.env.E2E_RUN_ID, profile, node: process.version, stages: [], limits: 'Local production build; testing mode on; rate limiter off; no CDN/Supavisor/WAN; synthetic fixtures; no browser assets or signed-in load.' }
let monitor
let sampling = false
let peakConnections = 0, peakActive = 0, peakLockWaits = 0
try {
  const { rows: [article] } = await db.query(`SELECT id,slug,title,"viewCount" FROM articles WHERE status='PUBLISHED' AND "deletedAt" IS NULL AND NOT "isDebate" ORDER BY "publishedAt" DESC LIMIT 1`)
  if (!article) throw Error('No public fixture')
  const paths = ['/', '/category/opinion', `/articles/${article.slug}`]
  const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]
  async function request(path, options = {}) {
    const start = performance.now()
    try {
      const response = await fetch(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) })
      const body = await response.text()
      const renderError = /NEXT_HTTP_ERROR_FALLBACK|\n\w+:E\{|data-next-error/.test(body)
      return { ms: performance.now() - start, status: response.status, error: response.status !== 200 || renderError, path }
    } catch (error) { return { ms: performance.now() - start, status: 0, error: true, path, reason: error.name } }
  }
  async function stage(name, concurrency, job, total, durationMs = Infinity) {
    const before = performance.now(), samples = []
    let next = 0
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < total && performance.now() - before < durationMs) {
        const n = next++; samples.push(await job(n))
        if (Number.isFinite(durationMs)) await new Promise(resolve => setTimeout(resolve, 100))
      }
    }))
    const elapsedMs = performance.now() - before
    const times = samples.map(x => x.ms).sort((a, b) => a - b)
    const errors = samples.filter(x => x.error)
    const result = { name, concurrency, requests: samples.length, elapsedMs, requestsPerSecond: samples.length * 1000 / elapsedMs, p50: percentile(times, .5), p95: percentile(times, .95), p99: percentile(times, .99), max: times.at(-1), errors: errors.length, statuses: samples.reduce((a,x) => ({...a,[x.status]:(a[x.status]??0)+1}),{}), failures: errors.slice(0,5) }
    report.stages.push(result)
    console.log(JSON.stringify(result))
    // Stop before increasing pressure if a small stage is already unhealthy.
    if (errors.length || result.p95 > 3000) throw Error(`Stop threshold reached: ${name}/${concurrency}`)
  }
  monitor = setInterval(async () => {
    if (sampling) return
    sampling = true
    try {
      const { rows: [r] } = await db.query(`SELECT count(*)::int AS connections, count(*) FILTER (WHERE state='active')::int AS active, count(*) FILTER (WHERE wait_event_type='Lock')::int AS locks FROM pg_stat_activity WHERE datname=current_database()`)
      peakConnections = Math.max(peakConnections,r.connections); peakActive = Math.max(peakActive,r.active); peakLockWaits = Math.max(peakLockWaits,r.locks)
    } finally { sampling = false }
  }, 200)
  if (profile === 'mixed') {
    await stage('first-touch-mix', 5, n => request(paths[n % paths.length]), 15)
    for (const concurrency of [1, 5, 10, 20, 40, 100]) {
      await stage('warm-html-rsc', concurrency, n => request(paths[n % paths.length] + (n % 2 ? `?_rsc=launch${n}` : ''), n % 2 ? { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } } : {}), Math.max(30, concurrency * 3))
    }
    await stage('paced-reads-across-cache-expiry', 10, n => request(paths[n % paths.length]), 5000, 35000)
  }
  const prefix = `launch-${randomUUID()}`
  let unique = 0
  const visitIds = []
  const startViews = Number((await db.query('SELECT "viewCount" FROM articles WHERE id=$1',[article.id])).rows[0].viewCount)
  const startRows = Number((await db.query('SELECT count(*) FROM article_views WHERE "articleId"=$1',[article.id])).rows[0].count)
  for (const concurrency of [1, 5, 10, 20, 40, 100]) {
    const clients = Array.from({length: concurrency}, (_,n) => ({articleId:article.id,sessionId:`${prefix}-${unique+n}`,visitId:randomUUID(),activeSeconds:0}))
    visitIds.push(...clients.map(x => x.visitId))
    unique += clients.length
    await stage('same-article-analytics', concurrency, n => request('/api/analytics/track', { method:'POST', headers:{'Content-Type':'application/json','user-agent':'ConsiliumLocalLoad/1.0'}, body:JSON.stringify(clients[n % clients.length]) }), clients.length * 3)
  }
  const actualViews = Number((await db.query('SELECT "viewCount" FROM articles WHERE id=$1',[article.id])).rows[0].viewCount)-startViews
  const actualRows = Number((await db.query('SELECT count(*) FROM article_views WHERE "articleId"=$1',[article.id])).rows[0].count)-startRows
  const sessions = Number((await db.query('SELECT count(*) FROM article_engagement_sessions WHERE id = ANY($1::text[])', [visitIds])).rows[0].count)
  // Each stage sends 3 identical deliveries per visit. Exact persisted counts,
  // rather than HTTP 200 alone, establish whether analytics actually succeeded.
  report.analytics = { expectedUnique: unique, actualViews, actualRows, sessions }
  if (actualViews !== unique || actualRows !== unique || sessions !== unique) throw Error('Analytics persistence/deduplication mismatch')
} catch (error) {
  report.stopped = error.message
  process.exitCode = 1
} finally {
  clearInterval(monitor)
  report.database = { peakConnections, peakActive, peakLockWaits, samplingMs: 200 }
  fs.writeFileSync(`${process.env.E2E_RESULTS_DIR}/load-test.json`,JSON.stringify(report,null,2))
  await db.end()
}
