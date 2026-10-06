import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE, WRITER_STORAGE, EDITOR_GLOBAL_STORAGE } from './helpers/authStorage'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import type { Editor } from '@tiptap/core'
const clipboard = readFileSync('tests/fixtures/google-docs-economics.html', 'utf8')
async function json(page: Page) {
  return page
    .locator('.ProseMirror')
    .evaluate((el) => JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON()))
}
async function selectText(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate((el, text) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor
    let found = false
    ed.state.doc.descendants((node, pos) => {
      if (found || !node.isText || !node.text?.includes(text)) return
      const from = pos + node.text.indexOf(text)
      ed.chain()
        .focus()
        .setTextSelection({ from, to: from + text.length })
        .run()
      found = true
    })
    if (!found) throw new Error(`No text: ${text}`)
  }, text)
}
async function save(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/articles') &&
      ['POST', 'PUT', 'PATCH'].includes(r.request().method()) &&
      r.ok()
  )
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  return (await response).json()
}
async function paste(page: Page, html: string) {
  await page.locator('.ProseMirror').click()
  await page.locator('.ProseMirror').evaluate((el, html) => {
    const data = new DataTransfer()
    data.setData('text/html', html)
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    )
  }, html)
}
test('writer paste/table/figure → repeated save/reload → editor review/edit/schedule/publish → public → replace/delete/republish', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const writerContext = await browser.newContext({ storageState: WRITER_STORAGE })
  const editorContext = await browser.newContext({ storageState: EDITOR_GLOBAL_STORAGE })
  const adminContext = await browser.newContext({ storageState: ADMIN_STORAGE })
  const writer = await writerContext.newPage()
  const editor = await editorContext.newPage()
  const reader = await browser.newPage()
  const errors: string[] = []
  for (const page of [writer, editor, reader])
    page.on('pageerror', (error) => errors.push(error.message))
  const base = process.env.E2E_BASE_URL!
  let id = ''
  try {
    await writer.goto(`${base}/editorial/articles/new`)
    await writer
      .getByPlaceholder('Your headline here...')
      .fill(`Rich-content lifecycle ${Date.now()}`)
    await expect(writer.locator('.ProseMirror')).toBeVisible()
    await paste(writer, clipboard)
    await expect(writer.locator('.ProseMirror table tr')).toHaveCount(4)
    await expect(writer.locator('.ProseMirror table th')).toHaveCount(3)
    await writer.locator('.ProseMirror td').first().click()
    await writer.keyboard.press('End')
    await writer.keyboard.type(' revised')
    await writer.keyboard.press('Tab')
    await writer.keyboard.type('cell navigation')
    await writer.getByRole('button', { name: 'Add row above', exact: true }).click()
    await expect(writer.locator('.ProseMirror table tr')).toHaveCount(5)
    await writer
      .locator('.ProseMirror table tr')
      .filter({ hasText: /^$/ })
      .first()
      .locator('th,td')
      .first()
      .click()
    await writer.getByRole('button', { name: 'Delete row', exact: true }).click()
    await expect(writer.locator('.ProseMirror table tr')).toHaveCount(4)
    await writer.getByRole('button', { name: 'Add row below', exact: true }).click()
    await expect(writer.locator('.ProseMirror table tr')).toHaveCount(5)
    await writer
      .locator('.ProseMirror table tr')
      .filter({ hasText: /^$/ })
      .first()
      .locator('th,td')
      .first()
      .click()
    await writer.getByRole('button', { name: 'Delete row', exact: true }).click()
    await writer.getByRole('button', { name: 'Add column left', exact: true }).click()
    await expect(writer.locator('.ProseMirror table tr').first().locator('th,td')).toHaveCount(4)
    await writer
      .locator('.ProseMirror table tr')
      .first()
      .locator('th,td')
      .filter({ hasText: /^$/ })
      .first()
      .click()
    await writer.getByRole('button', { name: 'Delete column', exact: true }).click()
    await writer.getByRole('button', { name: 'Add column right', exact: true }).click()
    await expect(writer.locator('.ProseMirror table tr').first().locator('th,td')).toHaveCount(4)
    await writer
      .locator('.ProseMirror table tr')
      .first()
      .locator('th,td')
      .filter({ hasText: /^$/ })
      .first()
      .click()
    await writer.getByRole('button', { name: 'Delete column', exact: true }).click()
    await writer.locator('summary').filter({ hasText: 'Table caption' }).click()
    await writer.getByLabel('Table caption', { exact: true }).fill('UK inflation estimates')
    await writer.getByLabel('Table source', { exact: true }).fill('ONS')
    await writer.getByLabel('Table source URL', { exact: true }).fill('https://www.ons.gov.uk/')
    await writer.getByLabel('Table note', { exact: true }).fill('Illustrative values')
    await selectText(writer, 'Forecast')
    await writer.getByRole('button', { name: 'Bold (Ctrl+B)', exact: true }).click()
    await writer.locator('.ProseMirror').evaluate((el) => {
      const ed = (el as HTMLElement & { editor: Editor }).editor
      ed.chain().focus('end').run()
    })
    const png = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: '#c9a227' },
    })
      .png()
      .toBuffer()
    const chooser = writer.waitForEvent('filechooser')
    await writer.getByRole('button', { name: 'Insert image', exact: true }).click()
    await (await chooser).setFiles({ name: 'chart.png', mimeType: 'image/png', buffer: png })
    await expect(writer.getByLabel('Alternative text', { exact: true })).toBeVisible()
    await writer
      .getByLabel('Alternative text', { exact: true })
      .fill('Inflation declines towards two percent')
    await writer.getByLabel('Caption', { exact: true }).fill('UK CPI, 2024–2026')
    await writer.getByLabel('Credit', { exact: true }).fill('The Consilium')
    await writer.getByLabel('Source', { exact: true }).fill('Bank of England')
    await writer.getByLabel('Source URL', { exact: true }).fill('https://www.bankofengland.co.uk/')
    await writer.getByLabel('Note', { exact: true }).fill('Forecast begins in 2027')
    const first = await save(writer)
    id = first.id
    await writer.goto(`${base}/editorial/articles/${id}/edit`)
    await expect(writer.getByLabel('Alternative text', { exact: true })).toHaveValue(
      'Inflation declines towards two percent'
    )
    const storedBefore = JSON.parse(await json(writer))
    for (let i = 0; i < 2; i++) {
      await save(writer)
      await writer.reload()
      await expect(writer.locator('.ProseMirror table tr')).toHaveCount(4)
    }
    expect(JSON.parse(await json(writer))).toEqual(storedBefore)
    const submit = writer.waitForResponse(
      (r) =>
        r.url().includes(`/api/articles/${id}`) &&
        ['PUT', 'PATCH'].includes(r.request().method()) &&
        r.ok()
    )
    await writer.getByRole('button', { name: 'Submit', exact: true }).click()
    expect((await (await submit).json()).status).toBe('PENDING_REVIEW')
    await editor.goto(`${base}/editorial/review/${id}`)
    await expect(editor.locator('.ProseMirror table tr')).toHaveCount(4)
    await expect(editor.getByText('Note: Forecast begins in 2027', { exact: true })).toBeVisible()
    await editor.goto(`${base}/editorial/articles/${id}/edit`)
    await editor.locator('.ProseMirror td').first().click()
    await editor.keyboard.press('End')
    await editor.keyboard.type(' editorial')
    const edited = await save(editor)
    const scheduled = await editorContext.request.patch(
      `${base}/api/editorial/articles/${id}/review`,
      { data: { action: 'schedule', scheduledAt: '2099-01-01T12:00' } }
    )
    expect(scheduled.status(), await scheduled.text()).toBe(200)
    const publish = await editorContext.request.put(`${base}/api/articles/${id}`, {
      data: { content: edited.content, status: 'PUBLISHED' },
    })
    expect(publish.status(), await publish.text()).toBe(200)
    const published = await publish.json()
    for (const width of [375, 768, 1440]) {
      await reader.setViewportSize({ width, height: 900 })
      await reader.goto(`${base}/articles/${published.slug}`)
      await expect(reader.locator('.prose-consilium table tr')).toHaveCount(4)
      await expect(reader.locator('.prose-consilium table th')).toHaveCount(3)
      await expect(
        reader.locator('.prose-consilium td a[href="https://www.ons.gov.uk/"]')
      ).toBeVisible()
      await expect(reader.getByAltText('Inflation declines towards two percent')).toBeVisible()
      await expect(reader.getByText('Credit: The Consilium', { exact: true })).toBeVisible()
      await expect(reader.getByText('Note: Forecast begins in 2027', { exact: true })).toBeVisible()
      expect(
        await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
    }
    await editor.goto(`${base}/editorial/articles/${id}/edit`)
    const oldSrc = await editor.locator('.article-figure img').getAttribute('src')
    await editor.route('**/api/upload', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { error: 'Unavailable' } })
        : route.continue()
    )
    let replaceChooser = editor.waitForEvent('filechooser')
    await editor.getByRole('button', { name: 'Replace image', exact: true }).click()
    await (
      await replaceChooser
    ).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png })
    await expect(
      editor.getByText('Your original image is still here.', { exact: false })
    ).toBeVisible()
    expect(await editor.locator('.article-figure img').getAttribute('src')).toBe(oldSrc)
    await editor.unroute('**/api/upload')
    replaceChooser = editor.waitForEvent('filechooser')
    await editor.getByRole('button', { name: 'Replace image', exact: true }).click()
    await (
      await replaceChooser
    ).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png })
    await expect(editor.locator('.article-figure img')).not.toHaveAttribute('src', oldSrc!)
    await save(editor)
    await editor.reload()
    await expect(editor.getByLabel('Caption', { exact: true })).toHaveValue('UK CPI, 2024–2026')
    await editor.getByRole('button', { name: 'Delete figure', exact: true }).click()
    await save(editor)
    await reader.reload()
    await expect(reader.locator('.prose-consilium .article-figure')).toHaveCount(0)
    const final = await editorContext.request.get(`${base}/api/articles/${id}`)
    expect((await final.json()).content).not.toContain('"type":"figure"')
    expect(errors).toEqual([])
  } finally {
    if (id) {
      await adminContext.request.delete(`${base}/api/articles/${id}`)
      await adminContext.request.delete(`${base}/api/editorial/trash/${id}`)
    }
    await writerContext.close()
    await editorContext.close()
    await adminContext.close()
    await reader.close()
  }
})

test('every exposed formatting control operates, including keyboard buttons and table deletion', async ({
  browser,
}) => {
  test.setTimeout(60_000)
  const context = await browser.newContext({ storageState: ADMIN_STORAGE })
  const page = await context.newPage()
  const base = process.env.E2E_BASE_URL!
  let id = ''
  try {
    await page.goto(`${base}/editorial/articles/new`)
    await expect(page.locator('.ProseMirror')).toBeVisible()
    await page.locator('.ProseMirror').fill('Control audit text')
    await selectText(page, 'Control audit text')
    for (const [label, mark] of [
      ['Bold (Ctrl+B)', 'bold'],
      ['Italic (Ctrl+I)', 'italic'],
      ['Underline (Ctrl+U)', 'underline'],
      ['Strikethrough', 'strike'],
    ]) {
      const button = page.getByRole('button', { name: label, exact: true })
      await button.focus()
      await button.press('Enter')
      expect(await json(page)).toContain(`"type":"${mark}"`)
    }
    for (const style of ['h2', 'h3', 'h4', 'paragraph']) {
      await page.getByLabel('Text style').selectOption(style)
      expect(await json(page)).toContain(
        style === 'paragraph' ? '"type":"paragraph"' : `"level":${style.slice(1)}`
      )
    }
    await selectText(page, 'Control audit text')
    await page.getByRole('button', { name: 'Insert / edit link', exact: true }).click()
    await page.getByLabel('Link URL', { exact: true }).fill('https://example.com/economics')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    expect(await json(page)).toContain('https://example.com/economics')
    await page.getByRole('button', { name: 'Remove link', exact: true }).click()
    expect(await json(page)).not.toContain('"type":"link"')
    for (const [label, node] of [
      ['Block quote', 'blockquote'],
      ['Code block', 'codeBlock'],
      ['Pull quote', 'pullQuote'],
      ['Bullet list', 'bulletList'],
      ['Numbered list', 'orderedList'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      expect(await json(page)).toContain(`"type":"${node}"`)
      await page.getByRole('button', { name: label, exact: true }).click()
    }
    for (const [label, align] of [
      ['Align left', 'left'],
      ['Align centre', 'center'],
      ['Align right', 'right'],
      ['Justify', 'justify'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      expect(await json(page)).toContain(`"textAlign":"${align}"`)
    }
    await selectText(page, 'Control audit text')
    await page.getByTitle('Text colour', { exact: true }).click()
    await page.getByRole('button', { name: 'Colour #ff0000', exact: true }).first().click()
    expect(await json(page)).toContain('#ff0000')
    await page.getByTitle('Highlight colour', { exact: true }).click()
    await page.getByRole('button', { name: 'Colour #ffff00', exact: true }).first().click()
    expect(await json(page)).toContain('"type":"highlight"')
    await page.getByRole('button', { name: 'Line spacing', exact: true }).click()
    await page.getByRole('button', { name: 'Double (2.0)', exact: true }).click()
    expect(await json(page)).toContain('"lineHeight":"2"')
    page.once('dialog', (dialog) => dialog.accept('Audit footnote'))
    await page.getByRole('button', { name: 'Insert footnote', exact: true }).click()
    expect(await json(page)).toContain('Audit footnote')
    await page.getByRole('button', { name: 'Horizontal rule', exact: true }).click()
    expect(await json(page)).toContain('"type":"horizontalRule"')
    const before = await json(page)
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
    expect(await json(page)).not.toBe(before)
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click()
    expect(await json(page)).toBe(before)
    await page.locator('.ProseMirror').evaluate((el) => {
      ;(el as HTMLElement & { editor: Editor }).editor.chain().focus('end').run()
    })
    await paste(page, '<ul><li>First audit item</li><li>Second audit item</li></ul>')
    await selectText(page, 'Second audit item')
    await page.getByRole('button', { name: 'Indent (Tab)', exact: true }).click()
    expect((await json(page)).split('"type":"bulletList"').length).toBeGreaterThan(2)
    await page.getByRole('button', { name: 'Outdent (Shift+Tab)', exact: true }).click()
    await page.evaluate(() => {
      window.print = () => {
        document.body.dataset.printInvoked = 'true'
      }
    })
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    expect(await page.evaluate(() => document.body.dataset.printInvoked)).toBe('true')
    await page.getByRole('button', { name: 'Insert table', exact: true }).click()
    await page.getByRole('button', { name: 'Insert 2 by 3 table', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.ProseMirror table tr')).toHaveCount(2)
    await page.locator('.ProseMirror th').first().click()
    await page.getByRole('button', { name: 'Toggle header row', exact: true }).click()
    await expect(page.locator('.ProseMirror table th')).toHaveCount(0)
    await page.getByRole('button', { name: 'Delete table', exact: true }).click()
    await expect(page.locator('.ProseMirror table')).toHaveCount(0)
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
    }
    id = (await save(page)).id
  } finally {
    if (id) {
      await context.request.delete(`${base}/api/articles/${id}`)
      await context.request.delete(`${base}/api/editorial/trash/${id}`)
    }
    await context.close()
  }
})

test('wide tables and standard/wide/portrait figures remain contained in editor and public layouts', async ({
  browser,
}) => {
  test.setTimeout(60_000)
  const writer = await browser.newContext({ storageState: WRITER_STORAGE })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE })
  const page = await writer.newPage()
  const publicPage = await browser.newPage()
  const base = process.env.E2E_BASE_URL!
  let id = ''
  try {
    const figures = []
    for (const [width, height] of [
      [600, 400],
      [2400, 150],
      [300, 1200],
    ]) {
      const buffer = await sharp({ create: { width, height, channels: 3, background: '#1a2744' } })
        .png()
        .toBuffer()
      const res = await writer.request.post(`${base}/api/upload`, {
        multipart: {
          bucket: 'article-images',
          file: { name: 'chart.png', mimeType: 'image/png', buffer },
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const data = await res.json()
      figures.push({
        type: 'figure',
        attrs: {
          src: data.url,
          width,
          height,
          alt: `Chart ${width} by ${height}`,
          caption: 'A detailed chart caption. '.repeat(30),
          source: 'Bank of England',
          sourceUrl: `https://www.bankofengland.co.uk/?reference=${'long'.repeat(150)}`,
          note: 'Forecast values begin in 2027.',
          credit: 'The Consilium',
        },
      })
    }
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const cells = Array.from({ length: 12 }, (_, i) => ({
      type: 'tableHeader',
      content: [paragraph(`Economic measure ${i}`)],
    }))
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Charts and table' }],
        },
        ...figures,
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('Interpret the data carefully.')] }],
        },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: cells },
            { type: 'tableRow', content: cells.map((c) => ({ ...c, type: 'tableCell' })) },
          ],
        },
      ],
    })
    const created = await writer.request.post(`${base}/api/articles`, {
      data: { title: `Responsive rich blocks ${Date.now()}`, content, status: 'PENDING_REVIEW' },
    })
    expect(created.status(), await created.text()).toBe(201)
    const article = await created.json()
    id = article.id
    const approved = await admin.request.patch(`${base}/api/editorial/articles/${id}/review`, {
      data: { action: 'approve' },
    })
    expect(approved.status(), await approved.text()).toBe(200)
    for (const width of [375, 768, 1440]) {
      await publicPage.setViewportSize({ width, height: 900 })
      await publicPage.goto(`${base}/articles/${article.slug}`)
      await expect(publicPage.locator('.prose-consilium .article-figure')).toHaveCount(3)
      await expect(publicPage.locator('.prose-consilium table th')).toHaveCount(12)
      expect(
        await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
      const region = publicPage.locator('.table-scroll')
      await region.focus()
      await publicPage.keyboard.press('ArrowRight')
      expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    }
    await page.close()
    const edit = await admin.newPage()
    for (const width of [375, 768, 1440]) {
      await edit.setViewportSize({ width, height: 900 })
      await edit.goto(`${base}/editorial/articles/${id}/edit`)
      await expect(edit.locator('.ProseMirror .article-figure')).toHaveCount(3)
      expect(
        await edit.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
      expect(
        await edit.locator('.tableWrapper').evaluate((el) => el.scrollWidth > el.clientWidth)
      ).toBe(true)
    }
    await edit.close()
  } finally {
    if (id) {
      await admin.request.delete(`${base}/api/articles/${id}`)
      await admin.request.delete(`${base}/api/editorial/trash/${id}`)
    }
    await writer.close()
    await admin.close()
    await publicPage.close()
  }
})
