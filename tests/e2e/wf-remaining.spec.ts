import {test,expect} from '@playwright/test'
import {signedIn,createAccount,signInAs,db,closeDb,removeMyAccounts,removeMyArticles,uniqueTitle,ArticleEditorPage} from './helpers/workflow'
test.afterAll(async()=>{await removeMyArticles();await removeMyAccounts();await closeDb()})

test('notifications opening marks only the current account read; failed read changes revert and retry',async({browser})=>{
 const own=await createAccount('WRITER','notifications');const other=await createAccount('WRITER','other-notifications')
 const title=uniqueTitle('notification');await db().notification.createMany({data:[own,other].map(user=>({userId:user.id,type:'comment',title,message:'A message for this account.'}))})
 const ctx=await signInAs(browser,own);const page=await ctx.newPage();await page.goto('/editorial',{waitUntil:'networkidle'})
 await page.route('**/api/editorial/notifications',r=>r.request().method()==='PATCH'?r.fulfill({status:500,json:{error:'Read update failed'}}):r.continue())
 const failed=page.waitForResponse(r=>r.url().endsWith('/api/editorial/notifications')&&r.request().method()==='PATCH');await page.getByRole('button',{name:'1 unread notifications',exact:true}).click();expect((await failed).status()).toBe(500);await expect(page.getByRole('alert').filter({hasText:'Read update failed'})).toBeVisible();await expect(page.getByRole('button',{name:'1 unread notifications',exact:true})).toBeVisible()
 await page.unrouteAll();const saved=page.waitForResponse(r=>r.url().endsWith('/api/editorial/notifications')&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Mark all read'}).click();expect((await saved).status()).toBe(200)
 expect(await db().notification.count({where:{userId:own.id,read:false}})).toBe(0);expect(await db().notification.count({where:{userId:other.id,read:false}})).toBe(1)
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByText(title,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Mark all read'})).toHaveCount(0);await ctx.close()
})

test('calendar dragging reschedules a scheduled article and rejects a past date without publishing',async({browser})=>{
 test.setTimeout(60000) // Two drag transitions, a fresh read and rejected reschedule.
 const ctx=await signedIn(browser,'admin');const page=await ctx.newPage();const author=await db().user.findFirstOrThrow({where:{role:'WRITER'}})
 const title=uniqueTitle('calendar');const row=await db().article.create({data:{title,slug:title.toLowerCase().replaceAll(' ','-'),authorId:author.id,content:'Calendar article body',status:'SCHEDULED',scheduledAt:new Date('2027-01-15T12:30:00Z')}})
 await page.goto('/editorial/calendar?month=2027-01',{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner()
 const link=page.getByRole('link',{name:new RegExp(title)}).first();const target=page.getByRole('button',{name:/Saturday, 16 January 2027/});const response=page.waitForResponse(r=>r.url().endsWith('/api/editorial/calendar')&&r.request().method()==='PATCH');await link.dragTo(target);expect((await response).status()).toBe(200)
 await expect.poll(async()=> (await db().article.findUniqueOrThrow({where:{id:row.id}})).scheduledAt?.toISOString()).toBe('2027-01-16T12:30:00.000Z')
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:/Saturday, 16 January 2027/}).press('Enter');await expect(page.getByRole('dialog')).toContainText(title);await page.getByLabel('Close day details').click();await link.click();await expect(new ArticleEditorPage(page).title()).toHaveValue(title)
 await db().article.update({where:{id:row.id},data:{scheduledAt:new Date('2026-10-15T12:30:00Z')}});await page.goto('/editorial/calendar?month=2026-10',{waitUntil:'networkidle'});const refused=page.waitForResponse(r=>r.url().endsWith('/api/editorial/calendar')&&r.request().method()==='PATCH');await link.dragTo(page.getByRole('button',{name:/Thursday, 1 October 2026/}));expect((await refused).status()).toBe(400);await expect(page.getByText('That would schedule the article in the past. Pick a future day, or edit the article to publish it now.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Dismiss',exact:true}).click();expect((await db().article.findUniqueOrThrow({where:{id:row.id}})).status).toBe('SCHEDULED');await ctx.close()
})

test('debate editing and cancelling preserve metadata after reopening',async({browser})=>{
 test.setTimeout(90_000)
 const ctx=await signedIn(browser,'editor');const page=await ctx.newPage();const title=uniqueTitle('debate-edit');const author=await db().user.findFirstOrThrow({where:{role:'WRITER'}});const articles=await Promise.all(['for','against'].map(side=>db().article.create({data:{title:`${title} ${side}`,slug:`${title}-${side}`.toLowerCase().replaceAll(' ','-'),authorId:author.id,content:'Debate argument',status:'DRAFT'}})));const row=await db().debate.create({data:{title,description:'Original framing',isActive:false,forArticleId:articles[0].id,againstArticleId:articles[1].id}})
 await page.goto(`/editorial/debates/${row.id}/edit`,{waitUntil:'networkidle'});await page.locator('input[type=text]').fill(title+' discarded');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await db().debate.findUniqueOrThrow({where:{id:row.id}})).title).toBe(title)
 await page.goto(`/editorial/debates/${row.id}/edit`,{waitUntil:'networkidle'});await page.locator('input[type=text]').fill(title+' revised');await page.locator('textarea').fill('Revised framing');const saved=page.waitForResponse(r=>r.url().endsWith(`/api/editorial/debates/${row.id}`)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Save Changes',exact:true}).click();expect((await saved).status()).toBe(200);await page.waitForURL('**/editorial/debates');await page.goto(`/editorial/debates/${row.id}/edit`,{waitUntil:'networkidle'});await expect(page.locator('textarea')).toHaveValue('Revised framing');await ctx.close()
})

test('public copy, share popups, article PDF and reader replies use their controls',async({browser,browserName})=>{
 test.setTimeout(90_000)
 const ctx=await signedIn(browser,'reader');const page=await ctx.newPage();const row=await db().article.findFirstOrThrow({where:{status:'PUBLISHED',deletedAt:null,isDebate:false}});await page.goto(`/articles/${row.slug}`,{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner()
 // Capture the browser print boundary; OS print dialogs are outside headless automation.
 await page.evaluate(()=>{window.print=()=>{document.documentElement.dataset.printed='yes'}})
 await page.getByLabel('Save article as PDF').click();await expect(page.locator('html')).toHaveAttribute('data-printed','yes')
 if(browserName==='chromium')await ctx.grantPermissions(['clipboard-read','clipboard-write']);
 await page.getByLabel('Copy link',{exact:true}).click();await expect(page.getByLabel('Link copied!')).toBeVisible();if(browserName==='chromium')expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(page.url())
 for(const [label,host] of [['Share on X / Twitter','twitter.com'],['Share on Facebook','facebook.com'],['Share on LinkedIn','linkedin.com']]){
  // External share endpoints are observed and aborted: never authenticate or post to a social account.
  await ctx.route(url=>url.hostname===host||url.hostname.endsWith('.'+host),r=>r.abort());const opened=ctx.waitForEvent('page');const request=ctx.waitForEvent('request',{predicate:r=>new URL(r.url()).hostname.endsWith(host)});await page.getByLabel(label,{exact:true}).click();const popup=await opened;expect(new URL((await request).url()).hostname).toMatch(new RegExp(host.replaceAll('.', '\\.')));await popup.close()
 }
 if(browserName==='chromium'){
  const pdf=await page.pdf({format:'A4',printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');await test.info().attach('published-article.pdf',{body:pdf,contentType:'application/pdf'})
 }
 const text=uniqueTitle('reply');await page.getByPlaceholder('Join the discussion…').fill(text);const posted=page.waitForResponse(r=>r.url().endsWith('/api/comments')&&r.request().method()==='POST');await page.locator('form').filter({has:page.getByPlaceholder('Join the discussion…')}).getByRole('button',{name:'Post',exact:true}).click();expect((await posted).status()).toBe(201)
 const comment=page.getByText(text,{exact:true}).locator('..');await comment.getByRole('button',{name:'Reply',exact:true}).click();await page.getByPlaceholder('Write a reply…').fill('A reply written through the reader interface.');const replied=page.waitForResponse(r=>r.url().endsWith('/api/comments')&&r.request().method()==='POST');await page.locator('form').filter({has:page.getByPlaceholder('Write a reply…')}).getByRole('button',{name:'Post',exact:true}).click();expect((await replied).status()).toBe(201);await page.reload({waitUntil:'networkidle'});await expect(page.getByText('A reply written through the reader interface.')).toBeVisible();await ctx.close()
})

test('dashboard achievement dismissal survives reopening and a failed dismissal remains retryable',async({browser})=>{
 const user=await createAccount('WRITER','achievements');const rows=await Promise.all(['first_publish','series_complete'].map(type=>db().writerAchievement.create({data:{userId:user.id,type}})))
 const ctx=await signInAs(browser,user);const page=await ctx.newPage();await page.goto('/editorial',{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner()
 await page.route('**/api/user/achievements/mark-seen',r=>r.fulfill({status:500,json:{error:'Could not mark achievement seen'}}))
 const failed=page.waitForResponse(r=>r.url().endsWith('/api/user/achievements/mark-seen'));await page.getByLabel('Dismiss',{exact:true}).click();expect((await failed).status()).toBe(500);await expect(page.getByRole('alert').filter({hasText:'Could not mark achievement seen'})).toBeVisible();await expect(page.getByText('Your first article has been published.')).toBeVisible()
 await page.unrouteAll()
 for(const label of ['Dismiss','Dismiss series achievements']){const done=page.waitForResponse(r=>r.url().endsWith('/api/user/achievements/mark-seen'));await page.getByLabel(label,{exact:true}).click();expect((await done).status()).toBe(200)}
 expect(await db().writerAchievement.count({where:{id:{in:rows.map(r=>r.id)},seenAt:{not:null}}})).toBe(2);await page.reload({waitUntil:'networkidle'});await expect(page.getByLabel('Dismiss',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Dismiss series achievements')).toHaveCount(0);await ctx.close()
})

test('legacy administration deletion confirms authored articles and refuses other roles',async({browser})=>{
 test.setTimeout(60000)
 const user=await createAccount('READER','legacy-erasure');const ctx=await signedIn(browser,'admin');const page=await ctx.newPage();await page.goto('/admin/data',{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner()
 const input=page.getByPlaceholder('reader@example.com');await input.fill(user.email)
 const search=page.waitForResponse(r=>r.url().endsWith('/api/admin/delete-user'));await page.getByRole('button',{name:'Search',exact:true}).click();expect((await search).status()).toBe(200)
 await expect(page.getByText(/all authored articles/)).toBeVisible();await page.getByRole('button',{name:'Confirm Delete',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await db().user.findUnique({where:{id:user.id}})).not.toBeNull()
 await input.fill(user.email);const found=page.waitForResponse(r=>r.url().endsWith('/api/admin/delete-user'));await page.getByRole('button',{name:'Search',exact:true}).click();expect((await found).status()).toBe(200);await page.getByRole('button',{name:'Confirm Delete',exact:true}).click();const deleted=page.waitForResponse(r=>r.url().endsWith('/api/admin/delete-user'));await page.getByRole('button',{name:'Yes, delete everything',exact:true}).click();expect((await deleted).status()).toBe(200);expect(await db().user.findUnique({where:{id:user.id}})).toBeNull();await page.getByRole('button',{name:'Delete Another Account'}).click();await expect(input).toHaveValue('')
 await page.getByRole('link',{name:'Login Attempts',exact:true}).click();await expect(page.getByRole('heading',{name:'Login Attempts',exact:true})).toBeVisible();await page.getByRole('link',{name:'Subscribers',exact:true}).click();await expect(page.getByRole('heading',{name:'Subscribers',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign Out',exact:true}).click();await page.waitForURL('**/editorial/login');await ctx.close()
 for(const role of ['writer','editor','reader','growth'] as const){const wrong=await signedIn(browser,role);const p=await wrong.newPage();await p.goto('/admin/data',{waitUntil:'networkidle'});await expect(p.getByRole('heading',{name:'Data Management',exact:true})).toHaveCount(0);expect((await wrong.request.post('/api/admin/delete-user',{data:{email:user.email,checkOnly:true}})).status()).toBe(403);await wrong.close()}
})

test('article status filters and pagination include every owned row and reset page after filtering',async({browser})=>{
 const user=await createAccount('WRITER','pagination');const prefix=uniqueTitle('pages');await db().article.createMany({data:Array.from({length:15},(_,i)=>({title:`${prefix} ${i}`,slug:`${prefix}-${i}`.toLowerCase().replaceAll(' ','-'),authorId:user.id,status:i<13?'DRAFT':'REJECTED',content:'Pagination fixture',updatedAt:new Date(Date.now()-i*1000)}))})
 const ctx=await signInAs(browser,user);const page=await ctx.newPage();await page.goto('/editorial/articles',{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner();await expect(page.locator('tbody tr')).toHaveCount(12);await expect(page.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(3);await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();await page.getByRole('button',{name:/^DRAFT 13$/i}).click();await expect(page.locator('tbody tr')).toHaveCount(12);await expect(page.getByText('Page 1 of 2',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:/^REJECTED 2$/i}).click();await expect(page.locator('tbody tr')).toHaveCount(2);await page.getByRole('button',{name:/^All 15$/i}).click();await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(12);await page.getByRole('link',{name:'My Drafts',exact:true}).click();await expect(page.getByRole('heading',{name:'My Drafts',exact:true})).toBeVisible();await expect(page.locator('tbody tr')).toHaveCount(12);await ctx.close()
})
