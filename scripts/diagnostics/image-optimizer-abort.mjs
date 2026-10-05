import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import {spawn} from 'node:child_process'
// A disposable minimal Next app: no database, credentials or application code.
// --original restores the original function only in this diagnostic child process.
const originalMode = process.argv.includes('--original')
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? `test-results/image-abort-${originalMode ? 'before' : 'after'}.json`
const cwd=process.cwd()
await fs.mkdir(path.join(cwd, 'test-results'), {recursive:true})
const root=await fs.mkdtemp(path.join(cwd,'test-results/consilium-image-repro-'))
let child
let log=''
const results=[]
try {
 await fs.symlink(path.join(cwd,'node_modules'),path.join(root,'node_modules'))
 await fs.mkdir(path.join(root,'app'));await fs.mkdir(path.join(root,'public'))
 await fs.copyFile(path.join(cwd,'public/team/sam-hunt.png'),path.join(root,'public/photo.png'))
 for(let i=0;i<3;i++)await fs.copyFile(path.join(cwd,'public/team/sam-hunt.png'),path.join(root,'public/photo'+i+'.png'))
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({private:true,dependencies:{next:'16.2.2',react:'19.2.4','react-dom':'19.2.4'}}))
 await fs.writeFile(path.join(root,'app/layout.js'),`export default function Layout({children}){return <html><body>{children}</body></html>}`)
 await fs.writeFile(path.join(root,'app/page.js'),`import Image from 'next/image';export default function Page(){return <Image src='/photo.png' width={640} height={750} alt='Diagnostic'/>}`)
 await fs.writeFile(path.join(root,'next.config.mjs'),`export default {turbopack:{root:${JSON.stringify(cwd)}}}`)
 await fs.writeFile(path.join(root,'probe.cjs'),`const Module=require('node:module'),fs=require('node:fs');const original=Module._extensions['.js'];Module._extensions['.js']=function(m,f){if(f.endsWith('/server/image-optimizer.js')){let s=fs.readFileSync(f,'utf8');if(${originalMode})s=s.replace(/const mocked = \\{\\s+req: new _mockrequest\\.MockedRequest\\(\\{ url: href, method, headers: \\{\\}, socket: _req\\.socket \\}\\),\\s+res: new _mockrequest\\.MockedResponse\\(\\)\\s+\\}; \\/\\/ Consilium: upstream Next\\.js #98168 response-socket backport/, 'const mocked = (0, _mockrequest.createRequestResponseMocks)({ url: href, method, socket: _req.socket });');s=s.replace('async function fetchInternalImage(href, _req, _res, handleRequest) {',"async function fetchInternalImage(href, _req, _res, handleRequest) {console.log('PROBE internal start',href,_req.socket.destroyed);_req.socket.once('close',()=>console.log('PROBE original socket close',href));");s=s.replace('await mocked.res.hasStreamed;',"console.log('PROBE awaiting stream',href,mocked.res.finished);await mocked.res.hasStreamed;console.log('PROBE streamed',href);");m._compile(s,f)}else original(m,f)};`)
 const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'}
 const next=path.join(cwd,'node_modules/next/dist/bin/next')
 const build=spawn(process.execPath,[next,'build',root],{cwd:root,env,stdio:['ignore','pipe','pipe']})
 let buildLog='';build.stdout.on('data',b=>buildLog+=b);build.stderr.on('data',b=>buildLog+=b)
 if(await new Promise(r=>build.on('close',r))!==0)throw Error(buildLog)
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
 child=spawn(process.execPath,['--require',path.join(root,'probe.cjs'),next,'start',root,'-p',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b)
 const base=`http://localhost:${port}`
 for(let i=0;i<100;i++){try{if((await fetch(base)).status===200)break}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error('Readiness deadline')}
 async function check(name,url){const start=Date.now();try{const res=await fetch(base+url,{headers:{Accept:'image/webp'},signal:AbortSignal.timeout(5000)});results.push({name,status:res.status,bytes:(await res.arrayBuffer()).byteLength,ms:Date.now()-start})}catch(e){results.push({name,error:e.message,ms:Date.now()-start})}}
 const abortCold=http.get(base+'/_next/image?url=%2Fphoto.png&w=640&q=75',{headers:{Accept:'image/webp'}},res=>res.resume());abortCold.on('error',()=>{});await new Promise(r=>abortCold.once('socket',sock=>sock.once('connect',()=>setTimeout(()=>{abortCold.destroy();r()},1))));
 await check('cold first request aborted','/_next/image?url=%2Fphoto.png&w=640&q=75')
 for(let i=0;i<3;i++){
  const url=`/_next/image?url=${encodeURIComponent('/photo'+i+'.png')}&w=640&q=75`
  await new Promise(resolve=>{const req=http.get(base+url,{headers:{Accept:'image/webp'}},res=>res.resume());req.on('error',()=>{});req.once('socket',sock=>{sock.once('connect',()=>setTimeout(()=>{req.destroy();resolve()},1))})})
  await check('after abort '+i,url)
 }
 await check('baseline still available','/_next/image?url=%2Fphoto.png&w=640&q=75')
} finally {
 if(child){child.kill('SIGTERM');await new Promise(r=>child.on('close',r))}
 await fs.rm(root,{recursive:true,force:true})
 await fs.mkdir(path.dirname(output), {recursive:true})
 await fs.writeFile(output,JSON.stringify({mode:originalMode?'original':'backported',next:'16.2.2',results,log},null,2))
 console.log(results)
}
