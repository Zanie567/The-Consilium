// Isolate the installed NextAuth fetch implementation from Next/RSC and the DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import ts from 'typescript'
import { chromium, webkit } from 'playwright'

const source = path.resolve('node_modules/next-auth/src/client/_utils.ts')
const library = ts.transpileModule(await fs.readFile(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const clientScript = library + `
window.addEventListener('unhandledrejection', e => console.log('PROBE:unhandledrejection:'+String(e.reason)));
window.addEventListener('error', e => console.log('PROBE:error:'+e.message));
window.addEventListener('pagehide', () => console.log('PROBE:pagehide'));
fetchData('session', {basePath:'/api/auth'}, {error:(code, details)=>console.error('[next-auth][error]['+code+'] '+details.error.message)});`
const pending = new Set()
const server = http.createServer((req, res) => {
  if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(clientScript) }
  if (req.url === '/api/auth/session') {
    const timer = setTimeout(() => { pending.delete(timer); res.setHeader('content-type', 'application/json'); res.end('{}') }, 1000)
    pending.add(timer)
    return
  }
  res.setHeader('content-type', 'text/html')
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; connect-src 'self'")
  res.end(req.url === '/destination' ? '<h1>Destination</h1>' : '<h1>Source</h1><a href="/destination">Navigate</a><script type="module" src="/client.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const cases = []
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage()
      const events = []
      page.on('console', m => events.push({ kind: 'console', type: m.type(), message: m.text() }))
      page.on('pageerror', error => events.push({ kind: 'pageerror', message: error.message }))
      page.on('requestfailed', req => events.push({ kind: 'requestfailed', path: new URL(req.url()).pathname, error: req.failure() }))
      for (let i = 0; i < 5; i++) {
        const started = page.waitForRequest(req => new URL(req.url()).pathname === '/api/auth/session')
        await page.goto(base, { waitUntil: 'domcontentloaded' })
        await started
        await page.getByRole('link', { name: 'Navigate', exact: true }).click()
        if (await page.getByRole('heading').innerText() !== 'Destination') throw new Error('Navigation did not complete')
      }
      cases.push({ name, events })
    } finally { await browser.close() }
  }
} finally {
  for (const timer of pending) clearTimeout(timer)
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
const target = process.argv[2] ?? 'test-results/session-cancellation.json'
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target, JSON.stringify({ nextAuthSource: 'node_modules/next-auth/src/client/_utils.ts', node: process.version, cases }, null, 2))
console.log(cases.map(c => ({ name: c.name, errors: c.events.filter(e => e.kind === 'pageerror').length,
  authLogs: c.events.filter(e => e.message?.includes('CLIENT_FETCH_ERROR')).length,
  unhandled: c.events.filter(e => e.message?.startsWith('PROBE:unhandledrejection:')).length })))
