// Disposable minimal Next 16 reproduction, with no app code, database or secrets.
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import {spawn} from 'node:child_process'
import {chromium,webkit} from 'playwright'
const root=await fs.mkdtemp(path.resolve('test-results/consilium-next-navigation-'))
const result={next:'16.2.2',node:process.version,cases:[]}
let child
try{
 await fs.symlink(path.resolve('node_modules'),path.join(root,'node_modules'))
 await fs.mkdir(path.join(root,'app','[slug]'),{recursive:true})
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({private:true,dependencies:{next:'16.2.2',react:'19.2.4','react-dom':'19.2.4'}}))
 await fs.writeFile(path.join(root,'app','layout.js'),`import Link from 'next/link';export default function Layout({children}){return <html><body><nav>{Array.from({length:20},(_,i)=>'/page'+i).concat(['/','/one','/two','/three']).map(p=><Link key={p} href={p} prefetch={true}>{p}</Link>)}</nav>{children}</body></html>}`)
 await fs.writeFile(path.join(root,'app','page.js'),`export default function Page(){return <h1>Home</h1>}`)
 await fs.writeFile(path.join(root,'app','[slug]','page.js'),`export const dynamic='force-dynamic';export default async function Page({params}){const {slug}=await params;await new Promise(r=>setTimeout(r,300));return <h1>{slug}</h1>}`)
 await fs.writeFile(path.join(root,'next.config.mjs'),`export default {turbopack:{root:'/Users/zanie/worktrees/consilium-workflow-completion'},experimental:{viewTransition:true},async headers(){return true?[{source:'/(.*)',headers:[{key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:"},{key:'X-Content-Type-Options',value:'nosniff'}]}]:[]}}`)
 const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'}
 const build=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'build',root],{cwd:root,env,stdio:['ignore','pipe','pipe']})
 let log='';build.stdout.on('data',b=>log+=b);build.stderr.on('data',b=>log+=b)
 const code=await new Promise(r=>build.on('close',r));if(code!==0)throw Error(log)
 for(const csp of [false,true]){
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
  child=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'start',root,'--port',String(port)],{cwd:root,env:{...env,PROBE_CSP:csp?'1':'0'},stdio:'ignore'})
  const base=`http://localhost:${port}`;for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{};await new Promise(r=>setTimeout(r,100));if(i===99)throw Error('server not ready')}
  for(const[name,engine]of [['chromium',chromium],['webkit',webkit]]){
   const browser=await engine.launch();const page=await browser.newPage();const events=[]
   await page.exposeFunction('recordRejection',message=>events.push({kind:'unhandledrejection',message}))
   await page.addInitScript(()=>window.addEventListener('unhandledrejection',e=>window.recordRejection(String(e.reason))))
   page.on('pageerror',e=>events.push({kind:'pageerror',message:e.message,stack:e.stack}));page.on('console',m=>{if(m.type()==='error')events.push({kind:'console',message:m.text()})});page.on('requestfailed',r=>events.push({kind:'requestfailed',url:r.url(),error:r.failure()}))
   for(let i=0;i<5;i++)for(const target of ['/','/one','/two','/three']){await page.goto(base+target,{waitUntil:'domcontentloaded'});await page.waitForTimeout(150)}
   await page.goto(base,{waitUntil:'domcontentloaded'})
   for(let i=0;i<5;i++){await page.getByRole('link',{name:'/one',exact:true}).click();await page.waitForURL('**/one');await page.goBack();await page.getByRole('link',{name:'/two',exact:true}).click();await page.waitForURL('**/two');await page.goBack();await page.goForward();await page.waitForURL('**/two')}
   result.cases.push({name,csp,events});await browser.close()
  }
  child.kill('SIGTERM');await new Promise(r=>child.on('close',r));child=undefined
 }
}finally{if(child){child.kill('SIGTERM');await new Promise(r=>child.on('close',r))}await fs.rm(root,{recursive:true,force:true})}
const target=process.argv[2]??'test-results/next-navigation.json';await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(result,null,2));console.log(result.cases.map(c=>({name:c.name,csp:c.csp,events:c.events.length,pageerrors:c.events.filter(e=>e.kind==='pageerror').length})))
