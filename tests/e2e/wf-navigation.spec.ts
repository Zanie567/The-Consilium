import {test,expect} from '@playwright/test'
import {collectConsoleErrors} from './helpers/console'
import {ArticleEditorPage} from './helpers/workflow'

test('public navigation links, browser history and repeated clicks keep pages usable without errors',async({page})=>{
 test.setTimeout(60000) // Multiple document/client/history transitions, each retains its own deadline.
 const errors=collectConsoleErrors(page)
 const response=await page.goto('/',{waitUntil:'networkidle'});expect(response?.status()).toBe(200);expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'")
 await new ArticleEditorPage(page).dismissCookieBanner()
 const nav=page.getByRole('navigation',{name:'Main navigation',exact:true})
 for(const [label,path] of [['About','/about'],['News','/category/news'],['Opinion','/category/opinion']]){
  await nav.getByRole('link',{name:label,exact:true}).click();await page.waitForURL(url=>url.pathname===path);await expect(page.locator('main h1').first()).toBeVisible()
 }
 await page.goBack({waitUntil:'networkidle'});await expect(page).toHaveURL(/\/category\/news$/)
 await page.goForward({waitUntil:'networkidle'});await expect(page).toHaveURL(/\/category\/opinion$/)
 for(let i=0;i<3;i++){await nav.getByRole('link',{name:'News',exact:true}).click();await nav.getByRole('link',{name:'About',exact:true}).click()}
 await page.waitForURL('**/about');await expect(page.locator('main h1').first()).toBeVisible()
 expect(errors,errors.join('\n')).toEqual([])
})
