// Real Safari on a disposable GitHub Mac only. No application database, secrets,
// authenticated state, staging services, personal Safari or production traffic.
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import ts from 'typescript'
import assert from 'node:assert/strict'

if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true' || process.env.CONSILIUM_CLOUD_SAFARI !== '1') throw Error('Requires an explicitly owned GitHub Mac runner')
if (process.env.GITHUB_REPOSITORY !== 'Zanie567/The-Consilium') throw Error('Unexpected repository')
const output = path.resolve('test-results/cloud-safari')
await fs.mkdir(output, { recursive: true })
const result = {
  diagnosticCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  applicationSourceBase: '0d5594f6aa3ef742221ce8a15be0053676812c11',
  scope: 'Minimal Next 16.2.2 + installed NextAuth fetch source, HTTP/1 custom diagnostic server; not full application/editorial/provider verification. Native Safari console messages inaccessible to WebDriver are not claimed absent.',
  node: process.version, os: { platform: os.platform(), release: os.release(), arch: os.arch() }, cases: [],
}
const owned = new Set()
let driver, session, server, aux
let driverBase
const delegated = []
const webdriverHTTPService = '/System/Library/PrivateFrameworks/WebDriver.framework/Versions/A/XPCServices/com.apple.WebDriver.HTTPService.xpc/Contents/MacOS/com.apple.WebDriver.HTTPService'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'consilium-cloud-safari-'))
const runID = path.basename(root)
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }
async function unusedPort() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  return port
}
function child(command, args, file, options = {}) {
  const processChild = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  owned.add(processChild)
  const chunks = []
  processChild.stdout.on('data', data => chunks.push(data))
  processChild.stderr.on('data', data => chunks.push(data))
  processChild.ownedGroup = options.detached === true
  processChild.completed = new Promise((resolve, reject) => {
    processChild.once('error', reject)
    processChild.once('close', async code => { owned.delete(processChild); await fs.writeFile(path.join(output, file), Buffer.concat(chunks)); resolve(code) })
  })
  return processChild
}
async function stop(processChild) {
  if (!processChild || !owned.has(processChild)) return
  if (processChild.ownedGroup) process.kill(-processChild.pid, 'SIGTERM')
  else processChild.kill('SIGTERM')
  await processChild.completed
}
async function api(method, endpoint, data, timeout = 15_000) {
  const response = await fetch(driverBase + endpoint, { method, ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(timeout) })
  const body = await response.json()
  if (response.status !== 200) throw Error(`WebDriver ${endpoint}: HTTP ${response.status} ${JSON.stringify(body)}`)
  return body.value
}
const execute = (script, args = []) => api('POST', `/session/${session}/execute/sync`, { script, args })
async function until(script, expectation, description) {
  const end = Date.now() + 10_000
  do {
    const value = await execute(script)
    if (expectation(value)) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < end)
  throw Error(`10s deadline: ${description}`)
}
async function navigate(base, route) {
  await api('POST', `/session/${session}/url`, { url: base + route })
  await until('return window.__hydrated === true', value => value === true, 'minimal Next hydration')
  await until('return document.querySelector("h1")?.textContent', value => value === (route === '/' ? 'Home' : route.slice(1)), 'destination heading')
}
async function click(route) {
  const element = await api('POST', `/session/${session}/element`, { using: 'css selector', value: `nav a[href="${route}"]` })
  const id = element['element-6066-11e4-a52e-4f735466cecf']
  await api('POST', `/session/${session}/element/${id}/click`, {})
  await until('return location.pathname + "|" + document.querySelector("h1")?.textContent', value => value === `${route}|${route === '/' ? 'Home' : route.slice(1)}`, 'actual navigation control')
}

try {
  await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'))
  await fs.mkdir(path.join(root, 'app', '[slug]'), { recursive: true })
  await fs.mkdir(path.join(root, 'app', 'api', 'auth', 'session'), { recursive: true })
  await fs.mkdir(path.join(root, 'public'))
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { next: '16.2.2', react: '19.2.4', 'react-dom': '19.2.4' } }))
  const instrumentation = `window.__events=[];window.__record=e=>{window.__events.push(e);const a=JSON.parse(localStorage.getItem('consilium-cloud-probe')||'[]');a.push({...e,path:location.pathname});localStorage.setItem('consilium-cloud-probe',JSON.stringify(a))};window.addEventListener('error',e=>window.__record({kind:'window.error',message:e.message}));window.addEventListener('unhandledrejection',e=>window.__record({kind:'unhandledrejection',message:String(e.reason)}));window.addEventListener('securitypolicyviolation',e=>window.__record({kind:'csp',directive:e.violatedDirective,blocked:e.blockedURI}));window.addEventListener('pagehide',()=>window.__record({kind:'pagehide'}));const originalError=console.error.bind(console);console.error=(...a)=>{window.__record({kind:'console.error',message:a.map(String).join(' ')});originalError(...a)};const originalFetch=window.fetch.bind(window);window.fetch=(...a)=>{window.__record({kind:'fetch.start',url:String(a[0])});return originalFetch(...a).then(r=>{window.__record({kind:'fetch.response',url:r.url,status:r.status});return r})};`
  await fs.writeFile(path.join(root, 'app', 'layout.js'), `import Link from 'next/link';import Ready from './Ready';export default function Layout({children}){return <html><head><script dangerouslySetInnerHTML={{__html:${JSON.stringify(instrumentation)}}}/></head><body><nav>{Array.from({length:24},(_,i)=>'/page'+i).concat(['/','/one','/two','/three']).map(p=><Link key={p} href={p} prefetch={true} style={{marginRight:8}}>{p}</Link>)}</nav>{children}<Ready/><script type="module" src="/auth-client.js"/></body></html>}`)
  await fs.writeFile(path.join(root, 'app', 'Ready.js'), `'use client';import {useEffect} from 'react';export default function Ready(){useEffect(()=>{window.__hydrated=true},[]);return null}`)
  await fs.writeFile(path.join(root, 'app', 'page.js'), `export default function Page(){return <h1>Home</h1>}`)
  await fs.writeFile(path.join(root, 'app', '[slug]', 'page.js'), `import {connection} from 'next/server';export default async function Page({params}){await connection();const {slug}=await params;await new Promise(r=>setTimeout(r,300));return <h1>{slug}</h1>}`)
  await fs.writeFile(path.join(root, 'app', 'api', 'auth', 'session', 'route.js'), `export async function GET(){await new Promise(r=>setTimeout(r,1000));return Response.json({user:null})}`)
  const client = ts.transpileModule(await fs.readFile('node_modules/next-auth/src/client/_utils.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  await fs.writeFile(path.join(root, 'public', 'auth-client.js'), client + `\nwindow.__authStarted=true;fetchData('session',{basePath:'/api/auth'},{error:(code,details)=>console.error('[next-auth][error]['+code+'] '+details.error.message)});`)
  await fs.writeFile(path.join(root, 'server.cjs'), `const http=require('http'),fs=require('fs'),next=require('next');const port=Number(process.env.PROBE_PORT),app=next({dev:false,dir:__dirname,hostname:'127.0.0.1',port}),handle=app.getRequestHandler();app.prepare().then(()=>{const server=http.createServer((req,res)=>{const record=kind=>fs.appendFileSync(process.env.PROBE_NETWORK,JSON.stringify({kind,url:req.url,status:res.statusCode,ended:res.writableEnded,time:Date.now()})+'\\n');record('start');res.on('finish',()=>record('finish'));res.on('close',()=>{if(!res.writableEnded)record('cancelled')});handle(req,res)});server.listen(port,'127.0.0.1');process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0))})});`)
  await fs.writeFile(path.join(root, 'next.config.mjs'), `export default {turbopack:{root:${JSON.stringify(process.cwd())}},experimental:{viewTransition:true},async headers(){return[{source:'/(.*)',headers:[{key:'x-consilium-probe',value:${JSON.stringify(runID)}},...(process.env.PROBE_CSP==='1'?[{key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:"},{key:'X-Content-Type-Options',value:'nosniff'}]:[])]}]}}`)
  const servicePIDsBefore = new Set(execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.includes(webdriverHTTPService)).map(line => line.trim().split(/\s+/)[0]))
  const driverPort = await unusedPort()
  driverBase = `http://127.0.0.1:${driverPort}`
  driver = child('/usr/bin/safaridriver', ['-p', String(driverPort)], 'safaridriver.log', { detached: true })
  const readyEnd = Date.now() + 10_000
  while (Date.now() < readyEnd) {
    if (!owned.has(driver)) throw Error('Owned Safari driver exited before readiness')
    try { if ((await fetch(driverBase + '/status', { signal: AbortSignal.timeout(1000) })).status === 200) break } catch { /* bounded readiness only */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const listeners = execFileSync('/usr/sbin/lsof', ['-t', '-iTCP:' + driverPort, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\r?\n/)
  const listenerProcesses = listeners.map(pid => ({ pid, processGroup: execFileSync('/bin/ps', ['-p', pid, '-o', 'pgid='], { encoding: 'utf8' }).trim(), command: execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim(), uid: execFileSync('/bin/ps', ['-p', pid, '-o', 'uid='], { encoding: 'utf8' }).trim() }))
  result.driverOwnership = { spawnedPID: driver.pid, ownedProcessGroup: driver.pid, listenerProcesses }
  assert(listenerProcesses.length > 0 && listenerProcesses.every(processInfo => processInfo.processGroup === String(driver.pid) || (!servicePIDsBefore.has(processInfo.pid) && processInfo.command === webdriverHTTPService && processInfo.uid === String(process.getuid()))), 'Driver listener is neither owned nor a newly launched Apple XPC service')
  delegated.push(...listenerProcesses.filter(processInfo => processInfo.processGroup !== String(driver.pid)))
  const created = await api('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } }, 45_000)
  session = created.sessionId
  result.capabilities = created.capabilities
  await api('POST', `/session/${session}/timeouts`, { implicit: 0, pageLoad: 15_000, script: 10_000 })
  aux = http.createServer((req, res) => { result.crossOriginRequests = (result.crossOriginRequests ?? 0) + 1; res.end('Controlled cross-origin response, no Access-Control-Allow-Origin') })
  await new Promise(resolve => aux.listen(0, '127.0.0.1', resolve))
  const otherOrigin = `http://127.0.0.1:${aux.address().port}`
  for (const csp of [false, true]) {
    const phase = csp ? 'csp-on' : 'csp-off'
    const network = path.join(output, `${phase}-network.jsonl`)
    await fs.writeFile(network, '')
    const build = child(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'build', root], `${phase}-build.log`, { env: { ...env, PROBE_CSP: csp ? '1' : '0' } })
    assert.equal(await build.completed, 0, 'Minimal Next build')
    const port = await unusedPort()
    const base = `http://127.0.0.1:${port}`
    server = child(process.execPath, [path.join(root, 'server.cjs')], `${phase}-server.log`, { env: { ...env, PROBE_CSP: csp ? '1' : '0', PROBE_PORT: String(port), PROBE_NETWORK: network } })
    const deadline = Date.now() + 30_000
    let response
    while (Date.now() < deadline) {
      if (!owned.has(server)) throw Error('Owned minimal server exited')
      try { response = await fetch(base, { signal: AbortSignal.timeout(1000) }); if (response.status === 200) break } catch { /* bounded readiness only */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(response?.status, 200)
    assert.equal(response.headers.get('x-consilium-probe'), runID, 'Unattested server')
    await navigate(base, '/')
    await execute("localStorage.removeItem('consilium-cloud-probe');window.__events=[]")
    if (!csp) {
      const cors = await api('POST', `/session/${session}/execute/async`, { script: "const done=arguments[arguments.length-1];fetch(arguments[0]).then(r=>r.text()).then(()=>done({allowed:true})).catch(e=>done({allowed:false,name:e.name,message:e.message}));", args: [otherOrigin] })
      result.crossOriginControl = cors
      assert.equal(cors.allowed, false, 'Safari cross-origin response access must be denied')
      assert(result.crossOriginRequests > 0, 'Controlled CORS request must reach the separate origin')
      await execute("localStorage.removeItem('consilium-cloud-probe');window.__events=[]")
    }
    for (const route of ['/one', '/two', '/three', '/']) {
      await until('return window.__authStarted === true', value => value === true, 'installed NextAuth request starts')
      await navigate(base, route)
    }
    const controls = []
    for (const route of ['/one', '/two', '/three']) {
      await click(route)
      controls.push(await execute('return {url:location.pathname,documentURL:performance.getEntriesByType("navigation")[0]?.name}'))
      await api('POST', `/session/${session}/back`, {})
      await until('return location.pathname + "|" + document.querySelector("h1")?.textContent', value => value === '/|Home', 'back navigation')
      await api('POST', `/session/${session}/forward`, {})
      await until('return location.pathname + "|" + document.querySelector("h1")?.textContent', value => value === `${route}|${route.slice(1)}`, 'forward navigation')
      await click('/')
    }
    await navigate(base, '/')
    await until('return window.__events.some(e=>e.kind==="fetch.response" && e.url.endsWith("/api/auth/session") && e.status===200)', value => value === true, 'healthy browser session response exactly 200')
    const events = await execute("return JSON.parse(localStorage.getItem('consilium-cloud-probe')||'[]')")
    const windowErrors = events.filter(event => ['window.error', 'unhandledrejection', 'csp'].includes(event.kind))
    const sessionResponse = await fetch(base + '/api/auth/session')
    assert.equal(sessionResponse.status, 200)
    const image = await api('GET', `/session/${session}/screenshot`)
    await fs.writeFile(path.join(output, `${phase}-real-safari.png`), Buffer.from(image, 'base64'))
    const serverEvents = (await fs.readFile(network, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    result.cases.push({ phase, documentRoutes: ['/one', '/two', '/three', '/'], actualControls: controls, events, windowErrors,
      requests: { rscStarted: serverEvents.filter(event => event.kind === 'start' && event.url.includes('_rsc=')).length, cancelled: serverEvents.filter(event => event.kind === 'cancelled') },
      healthySessionHTTP: sessionResponse.status, screenshot: `${phase}-real-safari.png` })
    assert.equal(windowErrors.length, 0, 'All instrumented window errors, unhandled rejections and CSP violations are retained')
    await stop(server); server = null
  }
} catch (error) {
  result.failure = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  if (session) { try { await api('DELETE', `/session/${session}`) } catch (error) { result.sessionCleanupFailure = String(error); process.exitCode = 1 } }
  for (const processChild of [...owned]) await stop(processChild)
  for (const processInfo of delegated) {
    const running = () => { try { return execFileSync('/bin/ps', ['-p', processInfo.pid, '-o', 'command='], { encoding: 'utf8' }).trim() === processInfo.command } catch { return false } }
    if (running()) process.kill(Number(processInfo.pid), 'SIGTERM')
    const untilExited = Date.now() + 5000
    while (running() && Date.now() < untilExited) await new Promise(resolve => setTimeout(resolve, 100))
    if (running()) { result.delegatedCleanupFailure = processInfo; process.exitCode = 1 }
  }
  if (aux) { aux.closeAllConnections(); await new Promise(resolve => aux.close(resolve)) }
  await fs.rm(root, { recursive: true, force: true })
  result.cleanup = { ownedProcessesWaited: owned.size === 0, delegatedServicesAbsent: !result.delegatedCleanupFailure, temporaryAppRemoved: true, productionServicesUsed: false, databaseUsed: false, authenticatedStateUsed: false }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ diagnosticCommit: result.diagnosticCommit, capabilities: result.capabilities, cases: result.cases.map(c => ({ phase: c.phase, rscStarted: c.requests.rscStarted, cancelled: c.requests.cancelled.length, windowErrors: c.windowErrors.length })), failure: result.failure, cleanup: result.cleanup }))
}
