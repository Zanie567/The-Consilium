// Real user-gesture popup, without Next, authentication or provider traffic.
// Retain abort vs inert fulfilment evidence across macOS/Linux WebKit.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
const results = []
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html')
  res.end(`<button onclick="window.open('https://twitter.com/intent/tweet?url=http://example.test','_blank','noopener,noreferrer')">Share</button>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch()
    try {
      for (const mode of ['abort', 'fulfill']) {
        const context = await browser.newContext()
        try {
          await context.route('https://twitter.com/**', route => mode === 'abort' ? route.abort() : route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Controlled share destination</h1>' }))
          const page = await context.newPage()
          await page.goto(`http://127.0.0.1:${server.address().port}`)
          const events = []
          context.on('page', p => events.push({ type: 'page', url: p.url() }))
          context.on('request', r => events.push({ type: 'request', url: r.url() }))
          // Explicit probe deadlines record tooling failure; no retries or app filtering.
          const opened = context.waitForEvent('page', { timeout: 5000 })
          const request = context.waitForEvent('request', { predicate: r => new URL(r.url()).hostname === 'twitter.com', timeout: 5000 })
          const captured = Promise.allSettled([opened, request])
          await page.getByRole('button', { name: 'Share', exact: true }).click()
          const observations = await captured
          const outcomes = observations.map(r => r.status === 'fulfilled' ? { status: r.status } : { status: r.status, error: r.reason.message })
          if (mode === 'fulfill') {
            if (observations.some(r => r.status === 'rejected')) process.exitCode = 1
            else {
              const popup = observations[0].value
              await popup.getByRole('heading', { name: 'Controlled share destination' }).waitFor({ timeout: 5000 })
            }
          }
          results.push({ name, mode, events, outcomes })
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  }
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  const target = process.argv[2] ?? 'test-results/share-popup.json'
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ platform: process.platform, node: process.version, results }, null, 2))
}
console.log(JSON.stringify(results.map(r => ({ name: r.name, mode: r.mode, outcomes: r.outcomes }))))
