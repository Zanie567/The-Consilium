import { test, expect, type Page } from '@playwright/test'
import {
  ArticleEditorPage, articleByTitle, closeDb, docTypes, removeMyArticles, signedIn, uniqueTitle, confirmPublicChange } from './helpers/workflow'
import { makePng } from './helpers/e2eUtils'
import { collectConsoleErrors } from './helpers/console'

/**
 * One representative article built ONLY through the editor's own controls, then checked
 * at every stage a reader or colleague would meet it: in the editor, after saving and
 * reopening, in the editorial review preview, and on the published page.
 *
 * The stages are separate tests that share the article, in order (serial mode), so a
 * failure names the stage that lost content.
 */
test.describe.configure({ mode: 'serial' })

const TITLE = uniqueTitle('format')
const EXCERPT = 'A summary typed into the excerpt box.'
const CAPTION = 'A caption typed under the figure'
const CREDIT = 'Credit: Test Desk / Reuters'
const FOOTNOTE = 'The footnote text typed into the prompt.'
const LINK_URL = 'https://example.org/source'

let articleId = ''
let slug = ''

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

/** Click a palette swatch / option inside an open dropdown. */
const swatch = (page: Page, hex: string) => page.getByTitle(hex, { exact: true }).first()

async function newLine(page: Page, text = '') {
  await page.keyboard.press('Enter')
  if (text) await page.keyboard.type(text)
}

test('build the article using every control', async ({ browser }) => {
  test.setTimeout(180_000)
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  const ed = new ArticleEditorPage(page)
  await ed.openNew()

  // ── Document settings ────────────────────────────────────────────────────────────
  await ed.title().fill(TITLE)
  await ed.excerpt().fill(EXCERPT)

  // The document-settings panel is the <aside> that holds the tag box (the sidebar is one too).
  const aside = page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') })
  const tagInput = aside.getByPlaceholder('Add a tag, press Enter...')
  await tagInput.fill('economics')
  await tagInput.press('Enter')
  await tagInput.fill('monetary policy')
  await tagInput.press(',')
  await expect(aside.getByText('economics')).toBeVisible()
  await expect(aside.getByText('monetary policy')).toBeVisible()

  const category = aside.locator('select').first()
  await category.selectOption({ index: 1 })

  // ── Body: structure via typing shortcuts (there is no heading button) ────────────────
  await ed.body().click()
  await page.keyboard.type('## Main section heading')
  await newLine(page)
  await page.keyboard.type('Plain opening paragraph with bold word, italic word, underlined word, struck word, coloured word, highlighted word and a linked word.')
  await expect(ed.body().locator('h2')).toHaveText('Main section heading')

  // ── Inline formatting through the toolbar ─────────────────────────────────────────────
  await ed.select('bold word')
  await ed.tool('Bold (Ctrl+B)').click()
  await ed.select('italic word')
  await ed.tool('Italic (Ctrl+I)').click()
  await ed.select('underlined word')
  await ed.tool('Underline (Ctrl+U)').click()
  await ed.select('struck word')
  await ed.tool('Strikethrough').click()

  await ed.select('coloured word')
  await ed.tool('Text colour').click()
  await swatch(page, '#ff0000').click()

  await ed.select('highlighted word')
  await ed.tool('Highlight colour').click()
  await swatch(page, '#ffff00').click()

  await ed.select('linked word')
  await ed.tool('Insert / edit link').click()
  await page.getByPlaceholder('https://…').fill(LINK_URL)
  await page.getByRole('button', { name: 'Apply' }).click()

  const p = ed.body().locator('p', { hasText: 'Plain opening paragraph' })
  await expect(p.locator('strong')).toHaveText('bold word')
  await expect(p.locator('em')).toHaveText('italic word')
  await expect(p.locator('u')).toHaveText('underlined word')
  await expect(p.locator('s')).toHaveText('struck word')
  await expect(p.locator('span[style*="color"]')).toHaveText('coloured word')
  await expect(p.locator('mark')).toHaveText('highlighted word')
  await expect(p.locator('a')).toHaveAttribute('href', LINK_URL)

  // A second hex-typed colour and the "remove" paths, so those controls are exercised too.
  await ed.select('struck word')
  await ed.tool('Text colour').click()
  await page.getByPlaceholder('hex').fill('#00aa00')
  await page.getByPlaceholder('hex').press('Enter')
  await expect(p.locator('s span[style*="color"], span[style*="color"] s').first()).toBeVisible()
  await ed.select('struck word')
  await ed.tool('Text colour').click()
  await page.getByRole('button', { name: 'Remove colour' }).click()

  await ed.select('highlighted word')
  await ed.tool('Highlight colour').click()
  await page.getByRole('button', { name: 'No highlight' }).click()
  await expect(p.locator('mark')).toHaveCount(0)
  await ed.select('highlighted word')
  await ed.tool('Highlight colour').click()
  await swatch(page, '#ffff00').click()
  await expect(p.locator('mark')).toHaveText('highlighted word')

  // Link: cancel leaves things alone; remove clears it; re-apply for the saved article.
  await ed.select('linked word')
  await ed.tool('Insert / edit link').click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(p.locator('a')).toHaveCount(1)
  await ed.select('linked word')
  await ed.tool('Remove link').click()
  await expect(p.locator('a')).toHaveCount(0)
  await ed.select('linked word')
  await ed.tool('Insert / edit link').click()
  await page.getByPlaceholder('https://…').fill(LINK_URL)
  await page.getByPlaceholder('https://…').press('Enter')
  await expect(p.locator('a')).toHaveAttribute('href', LINK_URL)

  // ── Alignment and line spacing, each on its own paragraph ───────────────────────────
  await ed.moveToEnd()
  for (const [label, key, css] of [
    ['Align centre', 'centre', 'center'],
    ['Align right', 'right', 'right'],
    ['Justify', 'justify', 'justify'],
  ] as const) {
    await newLine(page, `Aligned ${key} paragraph.`)
    await ed.tool(label).click()
    await expect(ed.body().locator('p', { hasText: `Aligned ${key} paragraph.` })).toHaveCSS('text-align', css)
  }
  await newLine(page, 'Aligned left paragraph.')
  await ed.tool('Align right').click()
  await ed.tool('Align left').click()
  await expect(ed.body().locator('p', { hasText: 'Aligned left paragraph.' })).toHaveCSS('text-align', 'left')

  await newLine(page, 'Line spaced paragraph.')
  // The line-height mark applies to selected text, so select the paragraph first.
  await ed.select('Line spaced paragraph.')
  await ed.tool('Line spacing').click()
  await page.getByRole('button', { name: 'Double (2.0)' }).click()
  await expect(ed.body().locator('p', { hasText: 'Line spaced paragraph.' }).locator('span[style*="line-height"]')).toBeVisible()

  // ── Lists, with indent / outdent ─────────────────────────────────────────────────────
  await ed.moveToEnd()
  await newLine(page)
  await ed.tool('Bullet list').click()
  await page.keyboard.type('Bullet one')
  await newLine(page, 'Bullet two nested')
  await ed.tool('Indent (Tab)').click()
  await newLine(page, 'Bullet three back out')
  await ed.tool('Outdent (Shift+Tab)').click()
  await newLine(page)
  await newLine(page) // second Enter leaves the list
  await ed.tool('Numbered list').click()
  await page.keyboard.type('Step one')
  await newLine(page, 'Step two')
  await newLine(page)
  await newLine(page)
  await expect(ed.body().locator('ul > li').first()).toContainText('Bullet one')
  await expect(ed.body().locator('ul ul > li')).toContainText('Bullet two nested')
  await expect(ed.body().locator('ol > li')).toHaveCount(2)

  // ── Block formats ─────────────────────────────────────────────────────────────────────
  await ed.tool('Block quote').click()
  await page.keyboard.type('Blockquote text')
  await newLine(page)
  await newLine(page)
  await expect(ed.body().locator('blockquote')).toContainText('Blockquote text')

  await ed.tool('Code block').click()
  await page.keyboard.type('const answer = 42')
  await page.keyboard.press('ControlOrMeta+Enter') // exits the code block
  await expect(ed.body().locator('pre')).toContainText('const answer = 42')

  await page.keyboard.type('Pull quote text')
  await newLine(page, 'Paragraph with a footnote here')
  await ed.select('Pull quote text')
  await ed.tool('Pull quote').click()
  await expect(ed.body().locator('aside[data-type="pull-quote"]')).toHaveText('Pull quote text')
  await ed.select('Paragraph with a footnote here')
  await ed.moveToEnd()
  page.once('dialog', (d) => void d.accept(FOOTNOTE))
  await ed.tool('Insert footnote').click()
  await expect(ed.body().locator('sup[data-footnote]')).toHaveCount(1)
  await ed.moveToEnd()

  // Horizontal rule
  await newLine(page)
  await ed.tool('Horizontal rule').click()
  await expect(ed.body().locator('hr')).toHaveCount(1)

  // ── Table via the grid picker, then the table menu ─────────────────────────────────────
  await ed.tool('Insert table').click()
  await page.locator('div.grid button').nth(2 * 10 + 2).click() // 3 x 3
  const table = ed.body().locator('table')
  await expect(table).toHaveCount(1)
  await expect(table.locator('tr')).toHaveCount(3)
  await expect(table.locator('th')).toHaveCount(3)
  const cells = ['Region', 'Rate', 'Change', 'UK', '5.25', '+0.25', 'US', '5.50', '0.00']
  for (let i = 0; i < cells.length; i++) {
    await page.keyboard.type(cells[i])
    if (i < cells.length - 1) await page.keyboard.press('Tab')
  }
  // Table menu: every action, applied to a cell the user clicks first.
  const cell = (text: string) => table.locator('th, td').filter({ hasText: new RegExp(`^${text}$`) })
  const emptyCells = () => table.locator('th, td').filter({ hasText: /^$/ })

  await cell('UK').click()
  await page.getByTitle('Add row below').click()
  await expect(table.locator('tr')).toHaveCount(4)
  await emptyCells().first().click()
  for (const [i, text] of ['FR', '4.00', '-0.10'].entries()) {
    await page.keyboard.type(text)
    if (i < 2) await page.keyboard.press('Tab')
  }

  await cell('Rate').first().click()
  await page.getByTitle('Add column right').click()
  await expect(table.locator('tr').first().locator('th')).toHaveCount(4)
  await emptyCells().first().click()
  await page.getByTitle('Delete column').click()
  await expect(table.locator('tr').first().locator('th')).toHaveCount(3)

  await cell('US').click()
  await page.getByTitle('Add row above').click()
  await expect(table.locator('tr')).toHaveCount(5)
  await emptyCells().first().click()
  await page.getByTitle('Delete row').click()
  await expect(table.locator('tr')).toHaveCount(4)

  await cell('Change').click()
  await page.getByTitle('Add column left').click()
  await expect(table.locator('tr').first().locator('th')).toHaveCount(4)
  await emptyCells().first().click()
  await page.getByTitle('Delete column').click()
  await expect(table.locator('tr').first().locator('th')).toHaveText(['Region', 'Rate', 'Change'])
  await expect(table.locator('tr')).toHaveCount(4)
  await expect(table.locator('tr').nth(2).locator('td')).toHaveText(['FR', '4.00', '-0.10'])

  // ── Figure, caption and credit via the image control ─────────────────────────────────
  await ed.moveToEnd()
  const chooser = page.waitForEvent('filechooser')
  await ed.tool('Insert image').click()
  ;(await chooser).setFiles({ name: 'figure.png', mimeType: 'image/png', buffer: makePng(64) })
  const figure = ed.body().locator('figure.article-figure')
  await expect(figure.locator('img')).toBeVisible({ timeout: 15_000 })
  await figure.getByPlaceholder('Add a caption…').fill(CAPTION)
  await figure.getByPlaceholder(/Photo credit/).fill(CREDIT)

  // ── Undo / redo / print ────────────────────────────────────────────────────────────────
  await page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++ } })
  await ed.tool('Print').click()
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1)

  await ed.moveToEnd()
  await newLine(page, 'Temporary line to undo')
  await expect(ed.body()).toContainText('Temporary line to undo')
  await ed.tool('Undo (Ctrl+Z)').click()
  await expect(ed.body()).not.toContainText('Temporary line to undo')
  await ed.tool('Redo (Ctrl+Shift+Z)').click()
  await expect(ed.body()).toContainText('Temporary line to undo')
  await ed.tool('Undo (Ctrl+Z)').click()

  // ── Save, then check what the server stored ──────────────────────────────────────────────
  const saved = await ed.saveNow()
  articleId = saved.id
  await expect(page.getByText('Saved').first()).toBeVisible()

  const row = await articleByTitle(TITLE)
  expect(row, 'the article must be in the database').not.toBeNull()
  slug = row!.slug
  expect(row!.excerpt).toBe(EXCERPT)
  expect(row!.tags.map((t) => t.tag.name).sort()).toEqual(['economics', 'monetary policy'])
  expect(row!.categoryId).not.toBeNull()
  const { nodes, marks } = docTypes(JSON.parse(row!.content))
  for (const n of ['heading', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock',
    'pullQuote', 'footnoteRef', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell', 'figure']) {
    expect(nodes, `saved document is missing node "${n}"`).toContain(n)
  }
  for (const m of ['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight', 'link']) {
    expect(marks, `saved document is missing mark "${m}"`).toContain(m)
  }

  expect(errors, `console errors while building the article:\n${errors.join('\n')}`).toEqual([])
  await ctx.close()
})

/** What the editor shows for the saved article, used for both "reopen" checks. */
async function expectEditorShowsEverything(page: Page) {
  const ed = new ArticleEditorPage(page)
  await expect(ed.title()).toHaveValue(TITLE)
  await expect(ed.excerpt()).toHaveValue(EXCERPT)
  const body = ed.body()
  await expect(body.locator('h2')).toHaveText('Main section heading')
  const p = body.locator('p', { hasText: 'Plain opening paragraph' })
  await expect(p.locator('strong')).toHaveText('bold word')
  await expect(p.locator('em')).toHaveText('italic word')
  await expect(p.locator('u')).toHaveText('underlined word')
  await expect(p.locator('s')).toHaveText('struck word')
  await expect(p.locator('span[style*="color"]')).toHaveText('coloured word')
  await expect(p.locator('mark')).toHaveText('highlighted word')
  await expect(p.locator('a')).toHaveAttribute('href', LINK_URL)
  await expect(body.locator('p', { hasText: 'Aligned centre paragraph.' })).toHaveCSS('text-align', 'center')
  await expect(body.locator('p', { hasText: 'Aligned right paragraph.' })).toHaveCSS('text-align', 'right')
  await expect(body.locator('p', { hasText: 'Aligned justify paragraph.' })).toHaveCSS('text-align', 'justify')
  await expect(body.locator('p', { hasText: 'Line spaced paragraph.' }).locator('span[style*="line-height"]')).toBeVisible()
  await expect(body.locator('ul > li').first()).toContainText('Bullet one')
  await expect(body.locator('ul ul > li')).toContainText('Bullet two nested')
  await expect(body.locator('ol > li')).toHaveCount(2)
  await expect(body.locator('blockquote')).toContainText('Blockquote text')
  await expect(body.locator('pre')).toContainText('const answer = 42')
  await expect(body.locator('aside[data-type="pull-quote"]')).toContainText('Pull quote text')
  await expect(body.locator('sup[data-footnote]')).toHaveAttribute('data-footnote', FOOTNOTE)
  await expect(body.locator('hr')).toHaveCount(1)
  const table = body.locator('table')
  await expect(table.locator('tr')).toHaveCount(4)
  await expect(table.locator('th')).toHaveText(['Region', 'Rate', 'Change'])
  await expect(table.locator('tr').nth(1).locator('td')).toHaveText(['UK', '5.25', '+0.25'])
  await expect(table.locator('tr').nth(2).locator('td')).toHaveText(['FR', '4.00', '-0.10'])
  await expect(table.locator('tr').nth(3).locator('td')).toHaveText(['US', '5.50', '0.00'])
  const figure = body.locator('figure.article-figure')
  await expect(figure.locator('img')).toBeVisible()
  await expect(figure.getByPlaceholder('Add a caption…')).toHaveValue(CAPTION)
  await expect(figure.getByPlaceholder(/Photo credit/)).toHaveValue(CREDIT)
}

test('reopening the saved draft shows every formatting feature intact', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  await expectEditorShowsEverything(page)
  await expect(page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') }).getByText('economics')).toBeVisible()
  await ctx.close()
})

test('a second reload after a no-op save changes nothing', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  await ed.saveNow()
  await page.reload({ waitUntil: 'networkidle' })
  await expectEditorShowsEverything(page)
  await ctx.close()
})

test('writer submits the draft for review through the Submit button', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)

  const res = await ed.saving(() => page.getByRole('button', { name: 'Submit' }).click())
  expect(res.status(), await res.text()).toBe(200)
  expect((await res.json()).status).toBe('PENDING_REVIEW')
  expect((await articleByTitle(TITLE))!.status).toBe('PENDING_REVIEW')

  // The writer can no longer edit it, and is told why.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText('This article is under review and cannot be edited until an editor responds.')).toBeVisible()
  await expect(ed.title()).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0)
  await ctx.close()
})

test('the editor sees every feature in the review preview, then publishes from it', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.goto(`/editorial/review/${articleId}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()

  const body = page.locator('.prose-consilium .ProseMirror')
  await expect(body.locator('h2')).toHaveText('Main section heading')
  const p = body.locator('p', { hasText: 'Plain opening paragraph' })
  for (const [tag, word] of [['strong', 'bold word'], ['em', 'italic word'], ['u', 'underlined word'], ['s', 'struck word'], ['mark', 'highlighted word']]) {
    await expect(p.locator(tag), `preview ${tag}`).toHaveText(word)
  }
  await expect(p.locator('a')).toHaveAttribute('href', LINK_URL)
  await expect(body.locator('table tr')).toHaveCount(4)
  await expect(body.locator('pre')).toContainText('const answer = 42')
  await expect(body.locator('figure img')).toBeVisible()
  await expect(body.locator('figure figcaption')).toHaveText(CAPTION)
  await test.info().attach('representative-article-preview', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // Nothing public yet.
  const anon = await signedIn(browser, null)
  const before = await anon.request.get(`/articles/${slug}`)
  expect(before.status(), 'pending-review article must not be public').toBe(404)

  const publish = page.waitForResponse((r) => r.url().includes(`/api/editorial/articles/${articleId}/review`) && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Publish Now' }).click()
  await confirmPublicChange(page, 'Publish now')
  const res = await publish
  expect(res.status(), await res.text()).toBe(200)
  expect((await res.json()).status).toBe('PUBLISHED')
  expect((await articleByTitle(TITLE))!.status).toBe('PUBLISHED')
  await anon.close()
  await ctx.close()
})

test('the published article shows the content, semantic formatting and editor styling preserved', async ({ browser }) => {
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  const res = await page.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  expect(res?.status()).toBe(200)

  await expect(page.locator('h1')).toContainText(TITLE)
  const article = page.locator('.prose-consilium').first()
  await expect(article.locator('h2').first()).toHaveText('Main section heading')
  const p = article.locator('p', { hasText: 'Plain opening paragraph' })
  await expect(p.locator('strong')).toHaveText('bold word')
  await expect(p.locator('em')).toHaveText('italic word')
  await expect(p.locator('u')).toHaveText('underlined word')
  await expect(p.locator('s'), 'strikethrough must be published').toHaveText('struck word')
  await expect(p.locator('mark')).toHaveText('highlighted word')
  await expect(p.locator('a')).toHaveAttribute('href', LINK_URL)

  await expect(article.locator('ul > li').first()).toContainText('Bullet one')
  await expect(article.locator('ul ul > li')).toContainText('Bullet two nested')
  await expect(article.locator('ol > li')).toHaveCount(2)
  await expect(article.locator('blockquote')).toContainText('Blockquote text')
  await expect(article.locator('pre code'), 'code block must be published').toContainText('const answer = 42')
  await expect(article.locator('aside.pull-quote')).toHaveText('Pull quote text')
  await expect(article.locator('hr')).toHaveCount(1)

  const table = article.locator('table')
  await expect(table, 'table must be published').toHaveCount(1)
  await expect(table.locator('th')).toHaveText(['Region', 'Rate', 'Change'])
  await expect(table.locator('tr').nth(1).locator('td')).toHaveText(['UK', '5.25', '+0.25'])
  await expect(table.locator('tr').nth(2).locator('td')).toHaveText(['FR', '4.00', '-0.10'])
  await expect(table.locator('tr').nth(3).locator('td')).toHaveText(['US', '5.50', '0.00'])

  const figure = article.locator('figure.article-figure')
  await expect(figure.locator('img')).toBeVisible()
  expect(await figure.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(figure.locator('figcaption')).toHaveText(CAPTION)
  await expect(figure.locator('.image-credit')).toHaveText(CREDIT)

  await expect(article.locator('sup.footnote-ref')).toHaveCount(1)
  await expect(page.getByText(FOOTNOTE).first()).toBeVisible()

  await expect(p.locator('span[style*="color"]')).toHaveText('coloured word')
  await expect(article.locator('p', { hasText: 'Aligned centre paragraph.' })).toHaveCSS('text-align', 'center')
  await expect(article.locator('p', { hasText: 'Aligned right paragraph.' })).toHaveCSS('text-align', 'right')
  await expect(article.locator('p', { hasText: 'Aligned justify paragraph.' })).toHaveCSS('text-align', 'justify')
  expect(await article.locator('p', { hasText: 'Line spaced paragraph.' }).locator('span').evaluate(el=>parseFloat(getComputedStyle(el).lineHeight)/parseFloat(getComputedStyle(el).fontSize))).toBe(2)

  expect(errors, `console errors on the published article:\n${errors.join('\n')}`).toEqual([])
  await new ArticleEditorPage(page).dismissCookieBanner()
  await test.info().attach('representative-article-published', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await ctx.close()
})
