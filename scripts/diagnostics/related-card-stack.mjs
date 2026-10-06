import { chromium, webkit } from '@playwright/test'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const output = []
for (const [name, engine] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await engine.launch()
 try {
  const page=await browser.newPage()
  await page.setContent(`<style>article{position:relative;display:flex;flex-direction:column;width:350px;border:1px solid}a.overlay{position:absolute;inset:0;z-index:0}.image{position:relative;height:176px;background:gray}.body{position:relative;z-index:10;padding:20px}a.author{position:relative;z-index:10}h3{margin:0}.fixed .image,.fixed .body{pointer-events:none}.fixed a.author{pointer-events:auto}</style><article><a class="overlay" href="#article" aria-label="Related article"></a><div class="image"><div>Image surface</div></div><div class="body"><h3>Related article title</h3><p>Representative excerpt</p><a class="author" href="#author">Author</a></div></article>`)
  for (const state of ['before','after']) {
   if(state==='after')await page.locator('article').evaluate(el=>el.classList.add('fixed'))
   for(const [target,locator] of [['image','.image'],['body','h3'],['author','a.author']]) {
    const box=await page.locator(locator).boundingBox()
    const hit=await page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return {tag:el.tagName,href:el.closest('a')?.getAttribute('href')??null}}, {x:box.x+box.width/2,y:box.y+box.height/2})
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2)
    output.push({engine:name,state,target,hit,hash:await page.evaluate(()=>location.hash)})
   }
  }
 } finally {await browser.close()}
}
await fs.writeFile('test-results/related-card-stack.json',JSON.stringify({method:'Controlled DOM reproduction of the source card stacking rules; not a live Next application test',cases:output},null,2)+'\n')
for (const result of output) {
 const expected = result.target === 'author' ? '#author' : result.state === 'after' ? '#article' : null
 assert.equal(result.hit.href, expected, `${result.engine} ${result.state} ${result.target} hit target`)
 if (expected) assert.equal(result.hash, expected, `${result.engine} ${result.state} ${result.target} native click`)
}
console.log(`Verified ${output.length} controlled DOM click cases`)
