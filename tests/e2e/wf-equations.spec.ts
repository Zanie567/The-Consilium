import { test, expect, type Page, type Locator } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, confirmPublicChange, db, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Equations through the whole publication lifecycle, driven through the real UI:
 * the Σ dialog in the editor, save and reload, editorial review, publishing, and
 * the public page on desktop, phone, dark theme and print. Serial: each stage
 * uses the article the previous one produced, so a failure names the stage that
 * lost or broke an equation.
 */
test.describe.configure({ mode: 'serial' })

const TITLE = uniqueTitle('equations')
const INLINE = 'MR = MC'
const REGRESSION = 'Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i'
const MATRIX = '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'
const WIDE = Array.from({ length: 14 }, (_, i) => `\\frac{\\partial^2 U}{\\partial x_{${i}}^2}`).join(' + ') + ' = 0'

let articleId = ''

test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

const dialog = (page: Page) => page.getByRole('dialog', { name: /(Insert|Edit) equation/ })
const latexBox = (page: Page) => dialog(page).getByLabel('LaTeX')

async function openEquationDialog(page: Page) {
  await page.getByTitle('Insert or edit equation').click()
  await expect(dialog(page)).toBeVisible()
  await expect(latexBox(page)).toBeFocused()
}

/** Types LaTeX into the dialog and waits for the preview to accept it. */
async function typeLatex(page: Page, latex: string) {
  await latexBox(page).fill(latex)
  await expect(dialog(page).getByTestId('math-dialog-preview').locator('.katex')).toBeVisible()
  await expect(dialog(page).getByRole('status')).toContainText('Ready to')
}

/** Dispatches a real paste event carrying HTML, as a browser does for Ctrl+V. */
async function pasteHtml(page: Page, html: string) {
  await page.evaluate((payload) => {
    const target = document.querySelector('.tiptap-editor .ProseMirror') as HTMLElement
    const data = new DataTransfer()
    data.setData('text/html', payload)
    data.setData('text/plain', 'pasted')
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, html)
}

function equations(root: Locator) {
  return root.locator('.tiptap-math')
}

test('an author builds equations with the Σ dialog', async ({ browser }) => {
  test.setTimeout(150_000)
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  await ed.title().fill(TITLE)
  await ed.excerpt().fill('Equilibrium where marginal revenue equals marginal cost.')

  // Inline, mid-sentence, at the cursor.
  await ed.typeBody('Firms maximise profit where ')
  await openEquationDialog(page)
  await expect(dialog(page).getByRole('radio', { name: /Inline/ })).toBeChecked()
  await expect(dialog(page).getByRole('button', { name: 'Insert equation' })).toBeDisabled()
  await typeLatex(page, INLINE)
  await dialog(page).getByRole('button', { name: 'Insert equation' }).click()
  await expect(dialog(page)).toBeHidden()
  await expect(ed.body()).toBeFocused()
  await page.keyboard.type(', costing $5 or $10 per unit.')
  const firstParagraph = ed.body().locator('p').first()
  await expect(firstParagraph).toContainText('Firms maximise profit where')
  await expect(firstParagraph).toContainText(', costing $5 or $10 per unit.')
  await expect(equations(firstParagraph)).toHaveCount(1)
  // Dollar amounts typed by the author stay text.
  await expect(equations(ed.body())).toHaveCount(1)

  // A display equation on its own line, built with Ctrl/⌘+Enter.
  await page.keyboard.press('Enter')
  await openEquationDialog(page)
  await expect(dialog(page).getByRole('radio', { name: /Display/ })).toBeChecked()
  await typeLatex(page, REGRESSION)
  await latexBox(page).press('ControlOrMeta+Enter')
  await expect(dialog(page)).toBeHidden()
  await expect(ed.body().locator('div.tiptap-math--display')).toHaveCount(1)

  // A matrix from the template palette, without typing any LaTeX.
  await ed.moveToEnd()
  await page.keyboard.press('Enter')
  await openEquationDialog(page)
  await dialog(page).getByRole('button', { name: 'Insert 2 × 2 matrix' }).click()
  await expect(latexBox(page)).toHaveValue('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}')
  await expect(dialog(page).getByRole('status')).toContainText('Ready to insert')
  await dialog(page).getByRole('button', { name: 'Insert equation' }).click()
  await expect(ed.body().locator('div.tiptap-math--display')).toHaveCount(2)

  // Malformed LaTeX cannot be inserted; the input is kept and explained. Escape cancels.
  await ed.moveToEnd()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Utility: ')
  await openEquationDialog(page)
  await latexBox(page).fill('\\frac{\\partial U}{\\partial x')
  await expect(dialog(page).getByRole('status')).toContainText('A “{” is missing its closing “}”.')
  await expect(dialog(page).getByRole('button', { name: 'Insert equation' })).toBeDisabled()
  await expect(latexBox(page)).toHaveAttribute('aria-invalid', 'true')
  await latexBox(page).press('End')
  await page.keyboard.type('}')
  await expect(dialog(page).getByRole('status')).toContainText('Ready to insert')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(equations(ed.body())).toHaveCount(3)

  // Insert it for real, then undo and redo the insertion.
  await openEquationDialog(page)
  await typeLatex(page, '\\frac{\\partial U}{\\partial x}')
  await dialog(page).getByRole('button', { name: 'Insert equation' }).click()
  await expect(equations(ed.body())).toHaveCount(4)
  await ed.tool('Undo (Ctrl+Z)').click()
  await expect(equations(ed.body())).toHaveCount(3)
  await ed.tool('Redo (Ctrl+Shift+Z)').click()
  await expect(equations(ed.body())).toHaveCount(4)

  // Click an equation to edit it; the change replaces it in place.
  await equations(firstParagraph).first().click()
  await expect(dialog(page)).toHaveAccessibleName('Edit equation')
  await expect(latexBox(page)).toHaveValue(INLINE)
  await typeLatex(page, 'MR = MC = P')
  await dialog(page).getByRole('button', { name: 'Update equation' }).click()
  await expect(equations(firstParagraph).first().locator('annotation')).toHaveText('MR = MC = P')
  await ed.tool('Undo (Ctrl+Z)').click()
  await expect(equations(firstParagraph).first().locator('annotation')).toHaveText(INLINE)

  // Delete the partial-derivative equation from its dialog.
  await equations(ed.body()).last().click()
  await dialog(page).getByRole('button', { name: /Delete equation/ }).click()
  await expect(equations(ed.body())).toHaveCount(3)

  // Paste: an equation copied from the editor, and one copied from a published article.
  await ed.moveToEnd()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Inflation ')
  await pasteHtml(page, '<meta charset="utf-8"><span data-pm-slice="1 1 []" data-type="inline-math" data-latex="\\pi_t" style="color:red"></span>')
  await expect(equations(ed.body())).toHaveCount(4)
  await pasteHtml(page, '<p>Pasted <span class="math-inline"><span class="katex"><span class="katex-mathml"><math><semantics><mi>g</mi><annotation encoding="application/x-tex">g_t</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">g</span></span></span></p>')
  await expect(equations(ed.body())).toHaveCount(5)
  await expect(ed.body().locator('.tiptap-math annotation', { hasText: /^g_t$/ })).toHaveCount(1)

  // A very wide display equation, used later for the phone layout.
  await ed.moveToEnd()
  await page.keyboard.press('Enter')
  await openEquationDialog(page)
  await dialog(page).getByRole('radio', { name: /Display/ }).check()
  await typeLatex(page, WIDE)
  await dialog(page).getByRole('button', { name: 'Insert equation' }).click()
  await expect(equations(ed.body())).toHaveCount(6)
  // The cursor lands after the equation: typing continues on a new line, never replacing it.
  await expect(ed.body()).toBeFocused()
  await page.keyboard.type('Closing remark.')
  await expect(equations(ed.body())).toHaveCount(6)
  await expect(ed.body().locator('p').last()).toHaveText('Closing remark.')

  await test.info().attach('editor-with-equations', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await openEquationDialog(page)
  await expect(dialog(page)).toHaveAccessibleName('Insert equation')
  await typeLatex(page, '\\mathbb{E}[Y \\mid X]')
  await test.info().attach('equation-dialog', { body: await dialog(page).screenshot(), contentType: 'image/png' })
  await page.keyboard.press('Escape')

  const saved = await ed.saveNow()
  articleId = saved.id
  const stored = JSON.parse((await articleByTitle(TITLE))!.content)
  const found: Array<{ type: string; latex: string }> = []
  const walk = (n: { type?: string; attrs?: { latex?: string }; content?: unknown[] }) => {
    if (n.type === 'inlineMath' || n.type === 'blockMath') found.push({ type: n.type, latex: n.attrs!.latex! })
    ;(n.content as (typeof n)[] | undefined)?.forEach(walk)
  }
  walk(stored)
  expect(found).toEqual([
    { type: 'inlineMath', latex: INLINE },
    { type: 'blockMath', latex: REGRESSION },
    { type: 'blockMath', latex: MATRIX },
    { type: 'inlineMath', latex: '\\pi_t' },
    { type: 'inlineMath', latex: 'g_t' },
    { type: 'blockMath', latex: WIDE },
  ])
  expect(JSON.stringify(stored)).toContain('costing $5 or $10 per unit.')
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('equations survive a browser reload and stay editable', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(equations(ed.body())).toHaveCount(6)
  await expect(ed.body().locator('.tiptap-math--error')).toHaveCount(0)
  await expect(ed.body().locator('div.tiptap-math--display .katex-display')).toHaveCount(3)

  // Keyboard editing: select the inline equation with the arrow keys, then Enter.
  // Caret just after the equation (start of ", costing"), once the editor has registered it;
  // ArrowLeft then selects the equation and Enter opens it.
  await ed.select(', costing')
  await page.evaluate(() => window.getSelection()!.collapseToStart())
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')))
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('.tiptap-editor .ProseMirror') as unknown as { editor: { state: { selection: { empty: boolean } } } }).editor.state.selection.empty))
    .toBe(true)
  await page.keyboard.press('ArrowLeft')
  await expect(equations(ed.body()).first()).toHaveClass(/ProseMirror-selectednode/)
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toHaveAccessibleName('Edit equation')
  await expect(latexBox(page)).toHaveValue(INLINE)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(equations(ed.body())).toHaveCount(6)
  await ctx.close()
})

test('an equation that cannot be typeset blocks submission until it is fixed', async ({ browser }) => {
  const ctx = await signedIn(browser, 'writer')
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openExisting(articleId)
  await ed.moveToEnd()
  await page.keyboard.press('Enter')
  await pasteHtml(page, '<p>Broken <span data-type="inline-math" data-latex="\\frac{a"></span></p>')
  const broken = ed.body().locator('.tiptap-math--error')
  await expect(broken).toHaveText('\\frac{a')

  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText(/Equation 7 cannot be typeset: A “\{” is missing its closing “\}”/)).toBeVisible()
  expect((await articleByTitle(TITLE))!.status).toBe('DRAFT')

  // Fix it from the editor: the original input is there to correct.
  await broken.click()
  await expect(latexBox(page)).toHaveValue('\\frac{a')
  await typeLatex(page, '\\frac{a}{b}')
  await dialog(page).getByRole('button', { name: 'Update equation' }).click()
  await expect(ed.body().locator('.tiptap-math--error')).toHaveCount(0)

  const res = await ed.saving(() => page.getByRole('button', { name: 'Submit' }).click())
  expect(res.status(), await res.text()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('PENDING_REVIEW')
  await ctx.close()
})

test('the editor reviews the typeset equations read-only, then publishes', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  await page.goto(`/editorial/review/${articleId}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const preview = page.locator('.prose-consilium .ProseMirror')
  await expect(equations(preview)).toHaveCount(7)
  await expect(preview.locator('.tiptap-math .katex')).toHaveCount(7)
  // Clicking in the read-only preview never opens the editor.
  await equations(preview).first().click()
  await expect(dialog(page)).toHaveCount(0)

  const publish = page.waitForResponse((r) => r.url().includes(`/api/editorial/articles/${articleId}/review`) && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Publish Now' }).click()
  await confirmPublicChange(page, 'Publish now')
  expect((await publish).status()).toBe(200)
  expect((await articleByTitle(TITLE))!.status).toBe('PUBLISHED')
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('the published page typesets every equation on the server, accessibly', async ({ browser }) => {
  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  const slug = (await articleByTitle(TITLE))!.slug

  // Server-rendered: the HTML response itself already holds the typeset maths.
  const raw = await (await ctx.request.get(`/articles/${slug}`)).text()
  expect(raw).toContain('<span class="math-inline"><span class="katex">')
  expect(raw).toContain('<annotation encoding="application/x-tex">Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i</annotation>')
  expect(raw).not.toContain('mathslot')

  await page.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  const body = page.locator('#article-body')
  await expect(body.locator('.math-inline')).toHaveCount(4)
  await expect(body.locator('.math-display')).toHaveCount(3)
  await expect(body.locator('.math-error')).toHaveCount(0)
  // MathML for assistive technology, with the visual copy hidden from it.
  await expect(body.locator('math')).toHaveCount(7)
  await expect(body.locator('math[display="block"]')).toHaveCount(3)
  await expect(body.locator('.katex-html[aria-hidden="true"]')).toHaveCount(7)
  // No LaTeX source is visible to readers; dollar amounts are plain text.
  const visible = await body.evaluate((el) => (el as HTMLElement).innerText)
  expect(visible).not.toMatch(/\\beta|\\begin|\\frac/)
  expect(visible).toContain('costing $5 or $10 per unit.')
  // KaTeX fonts are self-hosted (CSP font-src 'self') and actually used.
  expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main') && document.fonts.check('italic 16px KaTeX_Math'))).toBe(true)
  // No KaTeX JavaScript is shipped to readers.
  const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.endsWith('.js')))
  for (const src of scripts) {
    const js = await (await ctx.request.get(src)).text()
    expect(js, `${src} must not contain the KaTeX renderer`).not.toContain('KaTeX parse error')
  }

  // Inline equations sit on the text baseline: the equation box overlaps the text line and
  // its bottom is within a fraction of an em of the surrounding text's bottom.
  const alignment = await page.evaluate(() => {
    const math = document.querySelector('#article-body p .math-inline') as HTMLElement
    const p = math.closest('p')!
    const text = Array.from(p.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.includes('Firms'))!
    const range = document.createRange()
    range.selectNodeContents(text)
    const textRects = Array.from(range.getClientRects())
    const textRect = textRects[textRects.length - 1]
    const mathRect = math.querySelector('.katex-html')!.getBoundingClientRect()
    const fontSize = parseFloat(getComputedStyle(p).fontSize)
    return { textTop: textRect.top, textBottom: textRect.bottom, mathTop: mathRect.top, mathBottom: mathRect.bottom, fontSize }
  })
  expect(Math.abs(alignment.mathBottom - alignment.textBottom)).toBeLessThan(alignment.fontSize * 0.45)
  expect(alignment.mathTop).toBeLessThan(alignment.textBottom)
  expect(alignment.mathBottom).toBeGreaterThan(alignment.textTop)

  // Display equations are centred blocks with breathing room.
  const display = body.locator('.math-display').first()
  const box = (await display.boundingBox())!
  const articleBox = (await body.boundingBox())!
  expect(box.width).toBeGreaterThan(articleBox.width * 0.9)
  await expect(display.locator('.katex-display > .katex')).toHaveCSS('text-align', 'center')

  // Equations take the text colour in the light theme.
  const colours = await page.evaluate(() => ({
    text: getComputedStyle(document.querySelector('#article-body')!).color,
    math: getComputedStyle(document.querySelector('#article-body .katex')!).color,
  }))
  expect(colours.math).toBe(colours.text)
  await test.info().attach('public-equations-light', { body: await body.screenshot(), contentType: 'image/png' })
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('dark theme, phone width and print keep equations legible and contained', async ({ browser }) => {
  const slug = (await articleByTitle(TITLE))!.slug

  // Dark theme: equations follow the light-on-dark text colour.
  const dark = await signedIn(browser, null)
  const darkPage = await dark.newPage()
  await darkPage.addInitScript(() => localStorage.setItem('theme', 'dark'))
  await darkPage.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  await expect(darkPage.locator('html')).toHaveClass(/dark/)
  const darkColours = await darkPage.evaluate(() => ({
    text: getComputedStyle(document.querySelector('#article-body')!).color,
    math: getComputedStyle(document.querySelector('#article-body .katex')!).color,
    fracLine: getComputedStyle(document.querySelector('#article-body .frac-line') ?? document.querySelector('#article-body .katex')!).borderBottomColor,
  }))
  expect(darkColours.math).toBe(darkColours.text)
  expect(darkColours.fracLine).toBe(darkColours.text)
  expect(darkColours.math).not.toBe('rgb(26, 26, 26)')
  await test.info().attach('public-equations-dark', { body: await darkPage.locator('#article-body').screenshot(), contentType: 'image/png' })

  // Print: a wide equation is not clipped by a scroll box.
  await darkPage.emulateMedia({ media: 'print' })
  await expect(darkPage.locator('#article-body .math-display').first()).toHaveCSS('overflow-x', 'visible')
  await dark.close()

  // Phone: the page never scrolls sideways; the wide equation scrolls inside its own box,
  // and tall equations are not clipped vertically.
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true })
  const page = await phone.newPage()
  await page.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  const layout = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll<HTMLElement>('#article-body .math-display'))
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      boxes: boxes.map((b) => ({ scroll: b.scrollWidth, client: b.clientWidth, scrollH: b.scrollHeight, clientH: b.clientHeight, overflowX: getComputedStyle(b).overflowX })),
    }
  })
  expect(layout.pageOverflow).toBeLessThanOrEqual(0)
  const wide = layout.boxes.at(-1)!
  expect(wide.overflowX).toBe('auto')
  expect(wide.scroll).toBeGreaterThan(wide.client)
  for (const b of layout.boxes) expect(b.scrollH).toBeLessThanOrEqual(b.clientH + 1)
  await page.locator('#article-body .math-display').last().evaluate((el) => el.scrollBy({ left: 400 }))
  expect(await page.locator('#article-body .math-display').last().evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await test.info().attach('public-equations-phone', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await phone.close()
})

test('stored malformed or hostile equations degrade safely on the public page', async ({ browser }) => {
  const title = uniqueTitle('equations-hostile')
  const writer = await db().user.findUniqueOrThrow({ where: { email: 'writer@theconsilium.com' } })
  const latexes = ['\\frac{a', '\\href{javascript:alert(1)}{x}', '</span><script>alert(1)</script>', '\\text{<img src=x onerror=alert(1)>}', '\\def\\a{\\a\\a}\\a', 'x'.repeat(5000)]
  const content = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before. ' }, ...latexes.map((latex) => ({ type: 'inlineMath', attrs: { latex } }))] },
      ...latexes.map((latex) => ({ type: 'blockMath', attrs: { latex } })),
      { type: 'paragraph', content: [{ type: 'text', text: 'After the equations.' }] },
    ],
  })
  const slug = `wf-equations-hostile-${Date.now().toString(36)}`
  await db().article.create({ data: { title, slug, content, excerpt: 'Hostile equations fixture.', status: 'PUBLISHED', publishedAt: new Date(), authorId: writer.id } })

  const ctx = await signedIn(browser, null)
  const page = await ctx.newPage()
  let dialogs = 0
  page.on('dialog', (d) => {
    dialogs++
    void d.dismiss()
  })
  const res = await page.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  expect(res?.status()).toBe(200)
  const body = page.locator('#article-body')
  await expect(body).toContainText('After the equations.')
  // Malformed, link, macro and over-long input fall back to escaped source (inline and display).
  await expect(body.locator('.math-error')).toHaveCount(4 * 2)
  await expect(body.locator('.math-error code').first()).toHaveText('\\frac{a')
  // Markup-looking input is valid LaTeX: it is typeset as harmless symbols and text.
  await expect(body.locator('.math-inline:not(.math-error) annotation', { hasText: '<script>' })).toHaveCount(1)
  await expect(body.locator('.math-inline:not(.math-error) annotation', { hasText: '<img src=x' })).toHaveCount(1)
  await expect(body.locator('script, img, a[href^="javascript"]')).toHaveCount(0)
  expect(dialogs).toBe(0)
  await ctx.close()
})
