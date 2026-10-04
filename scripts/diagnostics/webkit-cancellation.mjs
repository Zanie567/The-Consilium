// Framework-free, same-origin cancellation probe. No app, database or credentials.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
const results = []
const pending = new Set()
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/slow')) {
    res.writeHead(200, {'content-type':'text/plain'});res.write('start\n');
    const timer = setTimeout(() => { pending.delete(timer); res.end('ok') }, 1000)
    pending.add(timer)
    return
  }
  if (req.url === '/destination') {res.setHeader('content-type','text/html');return res.end('<h1>Destination</h1>')}
  const csp = req.url.includes('csp')
  res.writeHead(200, { 'content-type': 'text/html', ...(csp ? {'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'"} : {}) })
  res.end(`<h1>Source</h1><a href="/destination">Navigate</a><script>
    window.rejections=[];window.addEventListener('unhandledrejection',e=>window.rejections.push(String(e.reason)));
    // Explicitly handle the rejection. An engine console error here cannot be an app's uncaught promise.
    fetch('/slow').then(r=>r.text()).catch(()=>{window.caught=true});
    window.addEventListener('pagehide',()=>queueMicrotask(()=>{fetch('/slow?unloading').then(r=>r.text()).catch(()=>{})}));
  </script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch()
    try {
      for (const variant of ['plain', 'csp']) {
        const page = await browser.newPage()
        const events = []
        page.on('console', m => {if (m.type()==='error') events.push({kind:'console',message:m.text()})})
        page.on('pageerror', e => events.push({kind:'pageerror',message:e.message}))
        page.on('requestfailed', r => events.push({kind:'requestfailed',url:r.url(),error:r.failure()}))
        for(let i=0;i<5;i++) {
          const started = page.waitForRequest(r => r.url().endsWith('/slow'))
          await page.goto(`${base}/${variant}`, {waitUntil:'domcontentloaded'})
          await started
          await page.getByRole('link',{name:'Navigate'}).click()
          if(await page.locator('h1').innerText()!=='Destination') throw new Error('navigation failed')
        }
        results.push({name,variant,events})
        await page.close()
      }
    } finally {await browser.close()}
  }
} finally {for(const timer of pending)clearTimeout(timer);await new Promise(resolve=>server.close(resolve))}
const target=process.argv[2]??'test-results/webkit-cancellation.json'
fs.mkdirSync(path.dirname(target),{recursive:true})
fs.writeFileSync(target,JSON.stringify({node:process.version,results},null,2))
console.log(JSON.stringify(results.map(r=>({name:r.name,variant:r.variant,console:r.events.filter(e=>e.kind==='console').length,pageerrors:r.events.filter(e=>e.kind==='pageerror').length,failed:r.events.filter(e=>e.kind==='requestfailed').length}))))
