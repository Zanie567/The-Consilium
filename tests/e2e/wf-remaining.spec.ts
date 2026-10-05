import {test,expect} from '@playwright/test'
import {signedIn,createAccount,signInAs,db,closeDb,removeMyAccounts,removeMyArticles,uniqueTitle,ArticleEditorPage} from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'
let debatesToRestore: string[] = []
test.afterAll(async()=>{await removeMyArticles();await db().debate.updateMany({where:{id:{in:debatesToRestore}},data:{isActive:true}});await removeMyAccounts();await closeDb()})

test('opening notifications marks nothing read; only Mark all read does, for the current account only, and a failed attempt retries', async ({ browser }) => {
  const own = await createAccount('WRITER', 'notifications')
  const other = await createAccount('WRITER', 'other-notifications')
  const title = uniqueTitle('notification')
  const article = await db().article.create({ data: { title: uniqueTitle('notification article'), slug: uniqueTitle('notification-slug').toLowerCase().replaceAll(' ', '-'), authorId: own.id, status: 'DRAFT', content: 'Linked notification draft.' } })
  await db().notification.createMany({ data: [own, other].map(user => ({ userId: user.id, type: 'comment', title, message: 'A message for this account.', articleId: article.id })) })
  const ctx = await signInAs(browser, own)
  const page = await ctx.newPage()
  const patches: string[] = []
  page.on('request', r => { if (r.method() === 'PATCH' && r.url().includes('/api/editorial/notifications')) patches.push(r.url()) })
  await page.goto('/editorial', { waitUntil: 'networkidle' })

  // Looking at the list changes nothing, however often it is opened.
  const bell = page.getByRole('button', { name: '1 unread notifications', exact: true })
  await bell.click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark all read' })).toBeVisible()
  await bell.click()
  await bell.click()
  await page.waitForLoadState('networkidle')
  expect(patches).toEqual([])
  expect(await db().notification.count({ where: { userId: own.id, read: false } })).toBe(1)

  // The explicit button fails visibly, leaves the notification unread, then succeeds on retry.
  await page.route('**/api/editorial/notifications', r => r.request().method() === 'PATCH' ? r.fulfill({ status: 500, json: { error: 'Read update failed' } }) : r.continue())
  const failed = page.waitForResponse(r => r.url().endsWith('/api/editorial/notifications') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Mark all read' }).click()
  expect((await failed).status()).toBe(500)
  await expect(page.getByRole('alert').filter({ hasText: 'Read update failed' })).toBeVisible()
  await expect(bell).toBeVisible()
  expect(await db().notification.count({ where: { userId: own.id, read: false } })).toBe(1)
  await page.unrouteAll()
  const saved = page.waitForResponse(r => r.url().endsWith('/api/editorial/notifications') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Mark all read' }).click()
  expect((await saved).status()).toBe(200)
  expect(await db().notification.count({ where: { userId: own.id, read: false } })).toBe(0)
  expect(await db().notification.count({ where: { userId: other.id, read: false } })).toBe(1)

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0)
  await page.getByRole('link', { name: new RegExp(title) }).click()
  await expect(new ArticleEditorPage(page).title()).toHaveValue(article.title)
  await ctx.close()
})

test('opening a notification always reaches its article; a failed read shows one-time feedback there and stays unread', async ({ browser }) => {
  const own = await createAccount('WRITER', 'individual-notifications')
  const title = uniqueTitle('individual notification')
  const article = await db().article.create({ data: { title: uniqueTitle('linked draft'), slug: uniqueTitle('linked-draft-slug').toLowerCase().replaceAll(' ', '-'), authorId: own.id, status: 'DRAFT', content: 'Linked draft content.' } })
  const notification = await db().notification.create({ data: { userId: own.id, type: 'comment', title, message: 'Your draft has feedback.', articleId: article.id } })
  const ctx = await signInAs(browser, own)
  const page = await ctx.newPage()
  await page.goto('/editorial', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const individual = `/api/editorial/notifications/${notification.id}`
  const unread = async () => (await db().notification.findUniqueOrThrow({ where: { id: notification.id } })).read === false
  await page.route(`**${individual}`, r => r.fulfill({ status: 503, json: { error: 'Individual read unavailable' } }))
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'consilium:route-feedback') throw new Error('Controlled route-feedback storage denial'); return original.call(this, key, value) } })

  await page.getByRole('button', { name: '1 unread notifications', exact: true }).click()
  const failed = page.waitForResponse(r => new URL(r.url()).pathname === individual)
  await page.getByRole('link', { name: new RegExp(title) }).click()
  expect((await failed).status()).toBe(503)

  // The navigation still happens, and the failure is reported on the page that was reached.
  await expect(new ArticleEditorPage(page).title()).toHaveValue(article.title)
  await expect(page).toHaveURL(new URL(`/editorial/articles/${article.id}/edit`, page.url()).href)
  const feedback = page.getByRole('alert').filter({ hasText: 'Individual read unavailable' })
  await expect(feedback).toBeVisible()
  await expect(feedback).toContainText(title)
  expect(await unread()).toBe(true)
  await page.getByRole('button', { name: 'Dismiss message', exact: true }).click()
  await expect(feedback).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe(`/editorial/articles/${article.id}/edit`)

  // It is one-time: reloading does not show it again, and it never appeared in the address.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(feedback).toHaveCount(0)
  expect(new URL(page.url()).search).toBe('')

  // The notification is still unread when notifications are loaded again.
  await page.goto('/editorial', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: '1 unread notifications', exact: true })).toBeVisible()

  // A deliberate retry succeeds, shows no failure, and marks it read.
  await page.unroute(`**${individual}`)
  await page.getByRole('button', { name: '1 unread notifications', exact: true }).click()
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === individual)
  await page.getByRole('link', { name: new RegExp(title) }).click()
  expect((await saved).status()).toBe(200)
  await expect(new ArticleEditorPage(page).title()).toHaveValue(article.title)
  await expect(page.getByRole('alert').filter({ hasText: 'could not be marked as read' })).toHaveCount(0)
  expect(await unread()).toBe(false)
  await page.goto('/editorial', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0)
  await ctx.close()
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
 const originalActive=await db().debate.findMany({where:{isActive:true},select:{id:true}});debatesToRestore=originalActive.map(d=>d.id);const ctx=await signedIn(browser,'editor');const page=await ctx.newPage();const title=uniqueTitle('debate-edit');const author=await db().user.findFirstOrThrow({where:{role:'WRITER'}});const articles=await Promise.all(['for','against'].map(side=>db().article.create({data:{title:`${title} ${side}`,slug:`${title}-${side}`.toLowerCase().replaceAll(' ','-'),authorId:author.id,content:'Debate argument',status:'PUBLISHED',publishedAt:new Date()}})));const row=await db().debate.create({data:{title,description:'Original framing',isActive:false,forArticleId:articles[0].id,againstArticleId:articles[1].id}})
 await page.goto(`/editorial/debates/${row.id}/edit`,{waitUntil:'networkidle'});await page.locator('input[type=text]').fill(title+' discarded');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await db().debate.findUniqueOrThrow({where:{id:row.id}})).title).toBe(title)
 await page.goto(`/editorial/debates/${row.id}/edit`,{waitUntil:'networkidle'});await page.locator('input[type=text]').fill(title+' revised');await page.locator('textarea').fill('Revised framing');await page.locator('input[type="datetime-local"]').fill('2027-02-15T12:00');await page.getByLabel('Active (shown on homepage)').check();const saved=page.waitForResponse(r=>r.url().endsWith(`/api/editorial/debates/${row.id}`)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Save Changes',exact:true}).click();expect((await saved).status()).toBe(200);await page.waitForURL('**/editorial/debates');await page.goto(`/editorial/debates/${row.id}/edit`,{waitUntil:'networkidle'});await expect(page.locator('textarea')).toHaveValue('Revised framing');await expect(page.locator('input[type="datetime-local"]')).toHaveValue('2027-02-15T12:00');await expect(page.getByLabel('Active (shown on homepage)')).toBeChecked();
 const voter=await createAccount('READER','debate-edit-voter');const reader=await signInAs(browser,voter);const publicPage=await reader.newPage();await publicPage.goto('/',{waitUntil:'networkidle'});await new ArticleEditorPage(publicPage).dismissCookieBanner();await expect(publicPage.getByRole('heading',{name:title+' revised',exact:true})).toBeVisible();const voted=publicPage.waitForResponse(r=>r.url().endsWith(`/api/debates/${row.id}/vote`)&&r.request().method()==='POST');await publicPage.getByLabel('Vote for the For side of this debate').click();expect((await voted).status()).toBe(200);expect(await db().debateVote.count({where:{debateId:row.id,userId:voter.id,side:'FOR'}})).toBe(1);await publicPage.reload({waitUntil:'networkidle'});await expect(publicPage.getByLabel('Vote for the For side of this debate')).toHaveCount(0);await reader.close();
 await page.getByLabel('Active (shown on homepage)').uncheck();const inactive=page.waitForResponse(r=>r.url().endsWith(`/api/editorial/debates/${row.id}`)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Save Changes',exact:true}).click();expect((await inactive).status()).toBe(200);await page.waitForURL('**/editorial/debates');await db().debate.updateMany({where:{id:{in:originalActive.map(d=>d.id)}},data:{isActive:true}});await ctx.close()
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
  // Fulfil the real popup request with an inert captured destination; no provider is contacted.
  await ctx.route(url=>url.hostname===host||url.hostname.endsWith('.'+host),r=>r.fulfill({status:200,contentType:'text/html',body:'<h1>Controlled share destination</h1>'}));const opened=ctx.waitForEvent('page');const request=ctx.waitForEvent('request',{predicate:r=>new URL(r.url()).hostname.endsWith(host)});await page.getByLabel(label,{exact:true}).click();const popup=await opened;expect(new URL((await request).url()).hostname).toMatch(new RegExp(host.replaceAll('.', '\\.')));await expect(popup.getByRole('heading',{name:'Controlled share destination',exact:true})).toBeVisible();const sharedURL=new URL((await request).url());expect(sharedURL.searchParams.get('url')??sharedURL.searchParams.get('u')).toBe(page.url());await popup.close()
 }
 if(browserName==='chromium'){
  const pdf=await page.pdf({format:'A4',printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');await test.info().attach('published-article.pdf',{body:pdf,contentType:'application/pdf'})
 }
 const text=uniqueTitle('reply');await page.getByPlaceholder('Join the discussion…').fill(text);const posted=page.waitForResponse(r=>r.url().endsWith('/api/comments')&&r.request().method()==='POST');await page.locator('form').filter({has:page.getByPlaceholder('Join the discussion…')}).getByRole('button',{name:'Post',exact:true}).click();expect((await posted).status()).toBe(201)
 const comment=page.getByText(text,{exact:true}).locator('..');await comment.getByRole('button',{name:'Reply',exact:true}).click();await page.getByPlaceholder('Write a reply…').fill('A reply written through the reader interface.');const replied=page.waitForResponse(r=>r.url().endsWith('/api/comments')&&r.request().method()==='POST');await page.locator('form').filter({has:page.getByPlaceholder('Write a reply…')}).getByRole('button',{name:'Post',exact:true}).click();expect((await replied).status()).toBe(201);await page.reload({waitUntil:'networkidle'});await page.getByText(text,{exact:true}).locator('..').getByRole('button',{name:'Show 1 reply',exact:true}).click();await expect(page.getByText('A reply written through the reader interface.')).toBeVisible();await ctx.close()
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
 const search=page.waitForResponse(r=>r.url().endsWith('/api/admin/delete-user'));await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();expect((await search).status()).toBe(200)
 await expect(page.getByText(/all authored articles/)).toBeVisible();await page.getByRole('button',{name:'Confirm Delete',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await db().user.findUnique({where:{id:user.id}})).not.toBeNull()
 await input.fill(user.email);const found=page.waitForResponse(r=>r.url().endsWith('/api/admin/delete-user'));await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();expect((await found).status()).toBe(200);await page.getByRole('button',{name:'Confirm Delete',exact:true}).click();const deleted=page.waitForResponse(r=>r.url().endsWith('/api/admin/delete-user'));await page.getByRole('button',{name:'Yes, delete everything',exact:true}).click();expect((await deleted).status()).toBe(200);expect(await db().user.findUnique({where:{id:user.id}})).toBeNull();await page.getByRole('button',{name:'Delete Another Account'}).click();await expect(input).toHaveValue('')
 await page.getByRole('link',{name:'Login Attempts',exact:true}).click();await expect(page.getByRole('heading',{name:'Login Attempts',exact:true})).toBeVisible();await page.getByRole('link',{name:'Subscribers',exact:true}).click();await expect(page.getByRole('heading',{name:'Subscribers',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign Out',exact:true}).click();await page.waitForURL('**/editorial/login');await ctx.close()
 for(const role of ['writer','editor','reader','growth'] as const){const wrong=await signedIn(browser,role);const p=await wrong.newPage();await p.goto('/admin/data',{waitUntil:'networkidle'});await expect(p.getByRole('heading',{name:'Data Management',exact:true})).toHaveCount(0);expect((await wrong.request.post('/api/admin/delete-user',{data:{email:user.email,checkOnly:true}})).status()).toBe(403);await wrong.close()}
})

test('article status filters and pagination include every owned row and reset page after filtering',async({browser})=>{
 const user=await createAccount('WRITER','pagination');const prefix=uniqueTitle('pages');await db().article.createMany({data:Array.from({length:15},(_,i)=>({title:`${prefix} ${i}`,slug:`${prefix}-${i}`.toLowerCase().replaceAll(' ','-'),authorId:user.id,status:i<13?'DRAFT':'REJECTED',content:'Pagination fixture',updatedAt:new Date(Date.now()-i*1000)}))})
 const ctx=await signInAs(browser,user);const page=await ctx.newPage();await page.goto('/editorial/articles',{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner();await expect(page.locator('tbody tr')).toHaveCount(12);await expect(page.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(3);await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();await page.getByRole('button',{name:/^DRAFT\s*13$/i}).click();await expect(page.locator('tbody tr')).toHaveCount(12);await expect(page.getByText('Page 1 of 2',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:/^REJECTED\s*2$/i}).click();await expect(page.locator('tbody tr')).toHaveCount(2);await page.getByRole('button',{name:/^All\s*15$/i}).click();await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(12);await page.getByRole('link',{name:'My Drafts',exact:true}).click();await expect(page.getByRole('heading',{name:'My Drafts',exact:true})).toBeVisible();await expect(page.locator('tbody tr')).toHaveCount(12);await ctx.close()
})

test('trash restore and permanent-delete failures retain content and visible errors until successful retries', async ({ browser }) => {
 test.setTimeout(90_000)
 const owner=await createAccount('WRITER','trash-retries')
 const rows=[]
 for(let i=0;i<3;i++) {const title=uniqueTitle(`Trash retry ${i}`);rows.push(await db().article.create({data:{title,slug:title.toLowerCase().replaceAll(' ','-'),authorId:owner.id,status:'DRAFT',deletedAt:new Date(),content:`Preserved trash content ${i}.`}}))}
 const ctx=await signInAs(browser,owner);const page=await ctx.newPage();const hydrationErrors=collectConsoleErrors(page);await page.clock.setFixedTime(new Date(Date.now()+120_000));await page.goto('/editorial/trash',{waitUntil:'networkidle'});await new ArticleEditorPage(page).dismissCookieBanner();expect(hydrationErrors,hydrationErrors.join('\n')).toEqual([])
 const item=(title:string)=>page.getByText(title,{exact:true}).locator('..').locator('..')
 const response=(id:string,method:string)=>page.waitForResponse(r=>new URL(r.url()).pathname===`/api/editorial/trash/${id}`&&r.request().method()===method)
 const first=response(rows[0].id,'PATCH');await item(rows[0].title).getByRole('button',{name:'Restore',exact:true}).click();expect((await first).status()).toBe(200);await expect(item(rows[0].title)).toHaveCount(0)
 const second=`/api/editorial/trash/${rows[1].id}`;await page.route(`**${second}`,r=>r.fulfill({status:503,json:{error:'Restore temporarily unavailable'}}));const failed=response(rows[1].id,'PATCH');await item(rows[1].title).getByRole('button',{name:'Restore',exact:true}).click();expect((await failed).status()).toBe(503);await expect(page.getByRole('alert').filter({hasText:'Restore temporarily unavailable'})).toBeVisible();expect((await db().article.findUniqueOrThrow({where:{id:rows[1].id}})).deletedAt).not.toBeNull()
 await page.unroute(`**${second}`);const retried=response(rows[1].id,'PATCH');await item(rows[1].title).getByRole('button',{name:'Restore',exact:true}).click();expect((await retried).status()).toBe(200);await expect(item(rows[1].title)).toHaveCount(0)
 const third=`/api/editorial/trash/${rows[2].id}`;await page.route(`**${third}`,r=>r.fulfill({status:503,json:{error:'Deletion temporarily unavailable'}}));await item(rows[2].title).getByRole('button',{name:'Delete',exact:true}).click();const denied=response(rows[2].id,'DELETE');await page.getByRole('button',{name:'Delete Forever',exact:true}).click();expect((await denied).status()).toBe(503);await expect(page.getByRole('alert').filter({hasText:'Deletion temporarily unavailable'})).toBeVisible();await expect(item(rows[2].title)).toBeVisible();expect((await db().article.findUniqueOrThrow({where:{id:rows[2].id}})).content).toBe(rows[2].content)
 await page.unroute(`**${third}`);await item(rows[2].title).getByRole('button',{name:'Delete',exact:true}).click();const deleted=response(rows[2].id,'DELETE');await page.getByRole('button',{name:'Delete Forever',exact:true}).click();expect((await deleted).status()).toBe(200);expect(await db().article.findUnique({where:{id:rows[2].id}})).toBeNull()
 for(const row of rows.slice(0,2)){const editor=new ArticleEditorPage(page);await editor.openExisting(row.id);await expect(editor.body()).toContainText(row.content);expect((await db().article.findUniqueOrThrow({where:{id:row.id}})).status).toBe('DRAFT');expect((await ctx.request.get(`/articles/${row.slug}`)).status()).toBe(404)}
 await ctx.close()
})

test('moderation load retry and delayed Recent data preserve the current Hidden tab', async ({ browser }) => {
  test.setTimeout(60_000)
  const writer = await createAccount('WRITER', 'moderation-order-author')
  const reader = await createAccount('READER', 'moderation-order-reader')
  const title = uniqueTitle('Moderation ordering')
  const article = await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: writer.id, content: 'Moderation selection fixture.', status: 'PUBLISHED', publishedAt: new Date() } })
  const hiddenBody = uniqueTitle('Current hidden comment')
  const recentBody = uniqueTitle('Recent visible comment')
  await db().comment.createMany({ data: [ { body: hiddenBody, articleId: article.id, userId: reader.id, isHidden: true }, { body: recentBody, articleId: article.id, userId: reader.id, isHidden: false } ] })
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  await page.route('**/api/editorial/comments?**', route => route.fulfill({ status: 503, json: { error: 'Controlled moderation load failure' } }))
  const failed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/comments')
  await page.goto('/editorial/comments', { waitUntil: 'networkidle' })
  expect((await failed).status()).toBe(503)
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("We couldn't load the comments.")
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.unroute('**/api/editorial/comments?**')
  const recovered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/comments')
  await page.getByRole('button', { name: 'Retry comments', exact: true }).click()
  expect((await recovered).status()).toBe(200)
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
  let release = () => {}
  let entered = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const observed = new Promise<void>(resolve => { entered = resolve })
  await page.route('**/api/editorial/comments?tab=recent&page=0', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    entered()
    await held
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: 'Recent', exact: true }).click()
    await observed
    const current = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/comments' && new URL(r.url()).searchParams.get('tab') === 'hidden')
    await page.getByRole('button', { name: /^Hidden \(/ }).click()
    expect((await current).status()).toBe(200)
    await expect(page.getByText(hiddenBody, { exact: true })).toBeVisible()
    await expect(page.getByText(recentBody, { exact: true })).toHaveCount(0)
    const obsolete = page.waitForResponse(r => new URL(r.url()).pathname === '/api/editorial/comments' && new URL(r.url()).searchParams.get('tab') === 'recent')
    release()
    const old = await obsolete
    expect(old.status()).toBe(200)
    await old.finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await expect(page.getByText(hiddenBody, { exact: true })).toBeVisible()
    await expect(page.getByText(recentBody, { exact: true })).toHaveCount(0)
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
  } finally { release(); await ctx.close() }
})
