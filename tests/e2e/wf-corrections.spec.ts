/**
 * The corrections lifecycle through real clicks, on a synthetic article in the isolated test database:
 * an editor prepares a correction and submits it; an administrator approves it; readers see the amended
 * text, one restrained notice and the dated note; a second correction joins the permanent history in order.
 * Also: the public page on a phone, in dark mode and in print; keyboard access to the notes.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ArticleEditorPage, closeDb, confirmDialog, db, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'

/** Evidence: attached to the report, and written to CORRECTIONS_EVIDENCE_DIR when set (lifecycle demonstration). */
async function snap(page: Page, name: string) {
  const image = await page.screenshot({ fullPage: true })
  await test.info().attach(name, { body: image, contentType: 'image/png' })
  const dir = process.env.CORRECTIONS_EVIDENCE_DIR
  if (dir) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${test.info().project.name}-${name}.png`), image)
  }
}

test.afterAll(async () => { await removeMyArticles(); await closeDb() })

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const body = (...texts: string[]) => JSON.stringify({ type: 'doc', content: texts.map(paragraph) })
const PUBLISHED_AT = new Date('2026-09-01T08:00:00.000Z')

async function syntheticArticle() {
  const title = uniqueTitle('corrections')
  const writer = await db().user.findFirstOrThrow({ where: { email: 'writer@theconsilium.com' } })
  const article = await db().article.create({
    data: {
      title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      content: body('Unemployment rose to 5.2% in September, the statistics office said.', 'Wages grew by 3% over the year.'),
      excerpt: 'A synthetic article for the corrections workflow test.',
      authorId: writer.id, status: 'PUBLISHED', publishedAt: PUBLISHED_AT,
    },
  })
  return article
}

/** Replace the first occurrence of `from` in the correction form's article editor with `to`, by real typing. */
async function amend(page: Page, from: string, to: string) {
  const ed = new ArticleEditorPage(page)
  await expect(ed.body()).toContainText(from)
  await ed.select(from)
  await page.keyboard.type(to)
  await expect(ed.body()).toContainText(to)
}

test('an editor prepares, an administrator approves, readers see the dated correction; a second one joins the history', async ({ browser }) => {
  test.setTimeout(180_000)
  const article = await syntheticArticle()
  const managePath = `/editorial/articles/${article.id}/corrections`

  // ── 0. The writer flags a suspected error in their own live article (existing comment channel) ───
  const writer = await signedIn(browser, 'writer')
  const wp = await writer.newPage()
  const wed = new ArticleEditorPage(wp)
  await wed.openExisting(article.id)
  await wed.select('5.2%')
  await wp.getByRole('button', { name: 'Add comment', exact: true }).click()
  await wp.getByPlaceholder('Add a comment...').fill('I think 5.2% is wrong: the ONS bulletin says 4.8%.')
  const flagged = wp.waitForResponse((r) => r.url().endsWith(`/articles/${article.id}/comments`) && r.request().method() === 'POST')
  await wp.getByRole('button', { name: 'Add comment', exact: true }).click()
  expect((await flagged).status()).toBe(201)
  await snap(wp, '0-writer-flags-error')
  await writer.close()
  const globalEditor = await db().user.findFirstOrThrow({ where: { email: 'editor.global@consilium.test' } })
  expect(await db().notification.count({ where: { articleId: article.id, type: 'published_article_flag', userId: globalEditor.id } })).toBe(1)

  // ── 1. The editor finds the article and prepares a correction ────────────────────────────────────
  const editor = await signedIn(browser, 'editor')
  const ep = await editor.newPage()
  await ep.goto('/editorial/articles', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(ep).dismissCookieBanner()
  const row = ep.locator('tr', { hasText: article.title })
  await row.getByRole('link', { name: 'Corrections' }).click()
  await expect(ep).toHaveURL(new RegExp(`${managePath}$`))
  await expect(ep.getByRole('heading', { level: 1 })).toHaveText(article.title)
  await ep.getByRole('button', { name: 'New correction, clarification or update' }).click()

  await expect(ep.getByRole('radio', { name: /^Correction/ })).toBeChecked()
  await ep.getByRole('textbox', { name: /^What the article said/ }).fill('Unemployment rose to 5.2% in September')
  await ep.getByRole('textbox', { name: /^What is correct/ }).fill('The correct figure was 4.8%')
  await amend(ep, '5.2%', '4.8%')
  await expect(ep.getByTestId('text-changes')).toContainText('4.8%')
  await ep.getByRole('button', { name: 'Draft it from step 2' }).click()
  const note1 = 'An earlier version of this article stated that unemployment rose to 5.2% in September. The correct figure was 4.8%. The article has been amended.'
  await ep.getByRole('textbox', { name: /^What readers will see/ }).fill(note1)
  await ep.getByRole('textbox', { name: /^Sources, who raised it/ }).fill('Internal: ONS labour market bulletin, table 3.')

  await ep.getByRole('button', { name: 'Show preview' }).click()
  const preview = ep.getByTestId('correction-preview')
  await expect(preview).toContainText('4.8% in September')
  await expect(preview.getByTestId('correction-notice')).toContainText('Correction')
  await expect(preview.getByTestId('corrections-section')).toContainText(note1)
  await expect(preview).not.toContainText('Internal: ONS')
  await snap(ep, '1-editor-prepares-and-previews')

  // Editors cannot publish; they submit for approval, after an explicit confirmation.
  await expect(ep.getByRole('button', { name: /^Publish/ })).toHaveCount(0)
  await ep.getByRole('button', { name: 'Submit for approval…' }).click()
  await expect(confirmDialog(ep)).toContainText('Nothing changes on the public site until an administrator approves it')
  const submitted = ep.waitForResponse((r) => r.url().endsWith(`/api/editorial/articles/${article.id}/corrections`) && r.request().method() === 'POST')
  await confirmDialog(ep).getByRole('button', { name: 'Submit' }).click()
  expect((await submitted).status()).toBe(201)
  await expect(ep.getByRole('status').filter({ hasText: 'Submitted for approval' })).toBeVisible()
  await expect(ep.getByTestId('pending-correction')).toContainText(note1)
  await snap(ep, '2-editor-submitted-for-approval')

  // Nothing public has changed yet.
  const anon = await signedIn(browser, null)
  const reader = await anon.newPage()
  await reader.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
  await expect(reader.locator('#article-body')).toContainText('5.2%')
  await expect(reader.getByTestId('correction-notice')).toHaveCount(0)
  await editor.close()

  // ── 2. An administrator reviews and approves it ──────────────────────────────────────────────────
  const admin = await signedIn(browser, 'admin')
  const ap = await admin.newPage()
  await ap.goto(managePath, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(ap).dismissCookieBanner()
  const pending = ap.getByTestId('pending-correction')
  await expect(pending).toContainText('Internal: ONS labour market bulletin') // internal context is visible to staff
  await expect(pending.getByTestId('text-changes')).toContainText('4.8%')
  await snap(ap, '3-admin-reviews-pending')
  await pending.getByRole('button', { name: 'Approve and publish…' }).click()
  await expect(confirmDialog(ap)).toContainText('permanent')
  const approved = ap.waitForResponse((r) => r.url().includes(`/api/editorial/articles/${article.id}/corrections/`) && r.request().method() === 'PATCH')
  await confirmDialog(ap).getByRole('button', { name: 'Approve and publish' }).click()
  expect((await approved).status()).toBe(200)
  await expect(ap.getByRole('status').filter({ hasText: 'is published' })).toBeVisible()

  // ── 3. Readers see the corrected article, one notice, and the dated note ─────────────────────────
  await reader.reload({ waitUntil: 'networkidle' })
  await expect(reader.locator('#article-body')).toContainText('4.8% in September')
  await expect(reader.locator('#article-body')).not.toContainText('5.2%')
  const notice = reader.getByTestId('correction-notice')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('This article has been corrected since it was first published.')
  const section = reader.getByTestId('corrections-section')
  await expect(section.getByRole('heading', { name: 'Corrections' })).toBeVisible()
  await expect(section).toContainText(note1)
  await expect(section.getByRole('link', { name: 'Read our corrections policy' })).toHaveAttribute('href', '/corrections')
  await expect(reader.getByText('1 September 2026').first()).toBeVisible() // original publication date unchanged
  await expect(reader.locator('body')).not.toContainText('Internal: ONS')
  await snap(reader, '4-public-after-first-correction')
  const stored = await db().articleCorrection.findMany({ where: { articleId: article.id } })
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({ status: 'PUBLISHED', type: 'CORRECTION' })
  expect((await db().article.findUniqueOrThrow({ where: { id: article.id } })).publishedAt).toEqual(PUBLISHED_AT)

  // Keyboard: the notice's link takes focus to the notes.
  await notice.getByRole('link').focus()
  await reader.keyboard.press('Enter')
  await expect(reader).toHaveURL(/#corrections$/)

  // ── 4. The administrator publishes a second correction directly ──────────────────────────────────
  await ap.getByRole('button', { name: 'New correction, clarification or update' }).click()
  await ap.getByRole('textbox', { name: /^What the article said/ }).fill('Wages grew by 3%')
  await ap.getByRole('textbox', { name: /^What is correct/ }).fill('Wages grew by 2.9%')
  await amend(ap, 'by 3%', 'by 2.9%')
  const note2 = 'An earlier version of this article said wages grew by 3% over the year. They grew by 2.9%.'
  await ap.getByRole('textbox', { name: /^What readers will see/ }).fill(note2)
  await ap.getByRole('button', { name: 'Publish correction…' }).click()
  await expect(confirmDialog(ap)).toContainText('original publication date does not change')
  const second = ap.waitForResponse((r) => r.url().endsWith(`/api/editorial/articles/${article.id}/corrections`) && r.request().method() === 'POST')
  await confirmDialog(ap).getByRole('button', { name: 'Publish now' }).click()
  expect((await second).status()).toBe(201)
  await expect(ap.getByRole('status').filter({ hasText: 'is published' })).toBeVisible()

  // The permanent history: both notes, oldest first, with who prepared and approved each.
  const history = ap.getByTestId('correction-history')
  await expect(history.locator(':scope > li')).toHaveCount(2)
  await expect(history.locator(':scope > li').nth(0)).toContainText(note1)
  await expect(history.locator(':scope > li').nth(0)).toContainText('approved by')
  await expect(history.locator(':scope > li').nth(1)).toContainText(note2)

  await reader.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
  await expect(reader.getByTestId('correction-notice')).toContainText('Read the 2 notes')
  const items = reader.getByTestId('corrections-section').locator('ol > li')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText(note1)
  await expect(items.nth(1)).toContainText(note2)
  await expect(reader.locator('#article-body')).toContainText('2.9%')
  await snap(reader, '6-public-after-second-correction')
  await snap(ap, '5-admin-history')

  // Phone width: the notice and notes stay readable without horizontal scrolling.
  await reader.setViewportSize({ width: 390, height: 844 })
  await reader.reload({ waitUntil: 'networkidle' })
  await expect(reader.getByTestId('correction-notice')).toBeVisible()
  await reader.getByTestId('corrections-section').scrollIntoViewIfNeeded()
  await expect(reader.getByTestId('corrections-section')).toBeVisible()
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await snap(reader, '7-public-mobile')

  // Dark theme and print keep the notes visible.
  await reader.emulateMedia({ colorScheme: 'dark' })
  await reader.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(reader.getByTestId('correction-notice')).toBeVisible()
  await snap(reader, '8-public-mobile-dark')
  await reader.emulateMedia({ media: 'print', colorScheme: 'light' })
  await expect(reader.getByTestId('corrections-section')).toBeVisible()
  await expect(reader.getByTestId('correction-notice')).toBeVisible()

  await anon.close()
  await admin.close()
})

test('the live-article editor offers Manage corrections and never autosaves the public text', async ({ browser }) => {
  const article = await syntheticArticle()
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(article.id)
  await expect(page.getByTestId('live-article-notice')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage corrections' }).first()).toHaveAttribute('href', `/editorial/articles/${article.id}/corrections`)
  const writes: string[] = []
  page.on('request', (r) => { if (/\/api\/articles\/[^/]+$/.test(r.url()) && ['PUT', 'PATCH'].includes(r.method())) writes.push(r.url()) })
  await ed.moveToEnd()
  await page.keyboard.type(' A silent change?')
  await page.waitForTimeout(3_000)
  expect(writes).toHaveLength(0)
  expect((await db().article.findUniqueOrThrow({ where: { id: article.id } })).content).not.toContain('silent change')
  await admin.close()
})
