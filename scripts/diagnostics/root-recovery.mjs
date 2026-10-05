// Minimal pinned-Next root recovery diagnostic. No application code, DB or providers.
// Records every diagnostic; the application's strict regression remains separate.
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'

await fs.mkdir('test-results', { recursive: true })
const root = await fs.mkdtemp(path.resolve('test-results/consilium-root-recovery-'))
const result = { next: '16.2.2', node: process.version, cases: [] }
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }
let child
try {
  await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'))
  await fs.mkdir(path.join(root, 'app', '[mode]'), { recursive: true })
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { next: '16.2.2', react: '19.2.4', 'react-dom': '19.2.4' } }))
  await fs.writeFile(path.join(root, 'next.config.mjs'), `export default {turbopack:{root:${JSON.stringify(process.cwd())}},async headers(){return [{source:'/(.*)',headers:[{key:'X-Consilium-Probe',value:${JSON.stringify(path.basename(root))}}]}]}}`)
  await fs.writeFile(path.join(root, 'app', 'fault.js'), `'use client';import {useEffect} from 'react';export default function Fault(){useEffect(()=>{if(sessionStorage.getItem('root-fault-fired')!=='1'){sessionStorage.setItem('root-fault-fired','1');throw Error('Controlled root failure')}},[]);return null}`)
  await fs.writeFile(path.join(root, 'app', 'layout.js'), `import Fault from './fault';export default function Layout({children}){return <html lang="en"><body><Fault/><header>Root chrome</header><main>{children}</main></body></html>}`)
  await fs.writeFile(path.join(root, 'app', '[mode]', 'page.js'), `import {connection} from 'next/server';export default async function Page({params}){await connection();const {mode}=await params;if(mode==='slow')await new Promise(r=>setTimeout(r,300));return <h1>Recovered page</h1>}`)
  await fs.writeFile(path.join(root, 'app', 'global-error.js'), `'use client';export default function GlobalError({error,unstable_retry,reset}){return <html lang="en"><body><h1>Root error</h1><p>{error.message}</p><button onClick={()=>{const action=new URLSearchParams(location.search).get('recovery');if(action==='reload')location.reload();else if(action==='reset')reset();else unstable_retry()}}>Try again</button></body></html>}`)
  const build = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'build', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  build.stdout.on('data', bytes => { log += bytes })
  build.stderr.on('data', bytes => { log += bytes })
  assert.equal(await new Promise(resolve => build.on('close', resolve)), 0, log)
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  child = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', root, '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', bytes => { log += bytes })
  child.stderr.on('data', bytes => { log += bytes })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; ; i++) {
    let response
    try { response = await fetch(`${base}/static`) } catch (error) {
      // A newly spawned server has not bound its port yet. Other failures propagate.
      if (error.cause?.code !== 'ECONNREFUSED') throw error
    }
    if (response) {
      assert.equal(response.headers.get('x-consilium-probe'), path.basename(root), 'Refusing an unattested existing server')
      assert.equal(response.status, 200)
      break
    }
    if (i === 100 || child.exitCode !== null) throw Error(`Owned diagnostic server failed to start: ${log}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch()
    try {
      for (const mode of ['static', 'slow']) for (const recovery of ['retry', 'reset', 'reload']) {
        const context = await browser.newContext()
        const events = []
        try {
          const page = await context.newPage()
          page.setDefaultTimeout(10_000)
          page.setDefaultNavigationTimeout(15_000)
          let phase = 'initial'
          page.on('pageerror', error => events.push({ phase, kind: 'pageerror', message: error.message, stack: error.stack }))
          page.on('console', message => { if (message.type() === 'error') events.push({ phase, kind: 'console', message: message.text(), location: message.location() }) })
          page.on('requestfailed', request => events.push({ phase, kind: 'requestfailed', url: request.url(), failure: request.failure() }))
          assert.equal((await page.goto(`${base}/${mode}?recovery=${recovery}`, { waitUntil: 'networkidle' })).status(), 200)
          await page.getByRole('heading', { name: 'Root error', exact: true }).waitFor()
          assert(events.some(event => event.message?.includes('Controlled root failure')), 'The one-time root exception must actually occur')
          phase = 'recovery'
          const response = recovery === 'reset' ? null : page.waitForResponse(response => new URL(response.url()).pathname === `/${mode}` && response.request().method() === 'GET')
          await Promise.all([
            page.getByRole('button', { name: 'Try again', exact: true }).click(),
            ...(response ? [response.then(value => assert.equal(value.status(), 200))] : []),
          ])
          await page.getByRole('heading', { name: 'Recovered page', exact: true }).waitFor()
          await page.waitForLoadState('networkidle')
          result.cases.push({ name, mode, recovery, recovered: true, events })
        } catch (error) {
          // Keep each failed comparison, continue the other modes, and fail below.
          result.cases.push({ name, mode, recovery, recovered: false, failure: error.stack, events })
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  }
} finally {
  if (child && child.exitCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve))
    child.kill('SIGTERM')
    await closed
  }
  await fs.rm(root, { recursive: true, force: true })
  result.cleanup = { temporaryAppRemoved: true, ownedServerWaited: true, productionServicesUsed: false }
  const target = process.argv[2] ?? 'test-results/root-recovery.json'
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(result, null, 2) + '\n')
}
console.log(result.cases.map(entry => ({ name: entry.name, mode: entry.mode, recovery: entry.recovery, newDiagnostics: entry.events.filter(event => event.phase === 'recovery').length })))
assert(result.cases.every(entry => entry.recovered), 'A root-recovery diagnostic failed; see retained per-case evidence')
