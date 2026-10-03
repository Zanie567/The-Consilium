import { test, expect, type Page } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, removeMyArticles, signedIn, storedObjects, uniqueTitle } from './helpers/workflow'
import { makePng } from './helpers/e2eUtils'

/**
 * Article image uploads through the editor: the toolbar image control, the cover image
 * (two buttons), and pasted images; valid files end up in (local) storage and survive a
 * save and reopen, invalid ones are refused with a visible reason and change nothing.
 * Storage is the local fake server, so uploads never reach a real bucket.
 */
test.afterAll(async () => {
  await removeMyArticles()
  await closeDb()
})

const storageBase = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const articleImages = async () => (await storedObjects()).filter((o) => o.key.startsWith('article-images/'))
/** Stored objects whose name contains `needle`: specs run in parallel and share the storage server, so count by file name, never by total. */
const storedNamed = async (needle: string) => (await articleImages()).filter((o) => o.key.includes(needle))
const alertOf = (p: Page) => p.locator('[role="alert"]:not(#__next-route-announcer__)')

async function newArticle(browser: import('@playwright/test').Browser, who: 'writer' | 'editor' = 'writer') {
  const ctx = await signedIn(browser, who)
  const page = await ctx.newPage()
  const ed = new ArticleEditorPage(page)
  await ed.openNew()
  const title = uniqueTitle('upload')
  await ed.title().fill(title)
  await ed.typeBody('Text before the image.')
  return { ctx, page, ed, title }
}

async function chooseFileVia(page: Page, click: () => Promise<void>, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser')
  await click()
  await (await chooser).setFiles(file)
}

test.describe('toolbar image (figure)', () => {
  test('a valid image is uploaded, shown, saved and still there after reopening', async ({ browser }) => {
    const { ctx, page, ed, title } = await newArticle(browser)
    const stamp = Date.now().toString(36)

    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: `chart one ${stamp}.png`, mimeType: 'image/png', buffer: makePng(64) })
    const img = ed.body().locator('figure.article-figure img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    const src = await img.getAttribute('src')
    expect(src, 'the figure points at the local storage server').toContain(`${storageBase()}/storage/v1/object/public/article-images/`)
    expect(src).toContain(`chart_one_${stamp}.png`) // the file name is sanitised, not kept verbatim

    const objects = await storedNamed(`chart_one_${stamp}.png`)
    expect(objects.length).toBe(1)
    expect(objects[0].type).toBe('image/png')
    // The stored bytes really are the image, served back publicly.
    const served = await fetch(src!)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')

    const { id } = await ed.saveNow()
    await ed.openExisting(id)
    await expect(ed.body().locator('figure.article-figure img')).toHaveAttribute('src', src!)
    await expect(ed.body()).toContainText('Text before the image.')
    expect((await articleByTitle(title))!.content).toContain(src!)
    await ctx.close()
  })

  test('a file that is not an image is refused with a reason, inserts nothing, stores nothing', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    await chooseFileVia(page, () => ed.tool('Insert image').click(), {
      name: 'invoice.png', // an image name on a non-image file
      mimeType: 'image/png',
      buffer: Buffer.from('this is plain text, not a PNG'),
    })
    await expect(page.getByText('Upload failed:')).toBeVisible()
    await expect(page.getByText(/File type not permitted/)).toBeVisible()
    await expect(ed.body().locator('figure')).toHaveCount(0)
    expect(await storedNamed('invoice.png')).toHaveLength(0)
    await expect(ed.body()).toContainText('Text before the image.')
    await ctx.close()
  })

  test('an image over 10 MB is refused with its limit', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    const uploads: string[] = []
    page.on('request', (r) => { if (r.url().includes('/api/upload')) uploads.push(r.url()) })
    const big = Buffer.concat([makePng(8), Buffer.alloc(10 * 1024 * 1024 + 1024)])
    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: 'huge.png', mimeType: 'image/png', buffer: big })
    await expect(page.getByText(/File too large \(max 10 MB\)/)).toBeVisible()
    // It stays until dismissed (it used to vanish after four seconds), wherever the page is scrolled.
    await page.waitForTimeout(5_000)
    await expect(page.getByText(/File too large \(max 10 MB\)/)).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss upload error' }).click()
    await expect(page.getByText('Upload failed:')).toHaveCount(0)
    await expect(ed.body().locator('figure')).toHaveCount(0)
    expect(await storedNamed('huge.png')).toHaveLength(0)
    expect(uploads, 'an oversized file must be refused before it is sent').toEqual([])
    await ctx.close()
  })

  test('a storage failure is shown, and the typed text is untouched', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    await page.route('**/api/upload', (route) => route.fulfill({ status: 500, json: { error: 'Upload failed: storage is down' } }))
    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: 'a.png', mimeType: 'image/png', buffer: makePng(32) })
    await expect(page.getByText('Upload failed:').first()).toBeVisible()
    await expect(page.getByText(/storage is down/)).toBeVisible()
    await expect(ed.body().locator('figure')).toHaveCount(0)
    await expect(ed.body()).toContainText('Text before the image.')

    // The fault clears; the same control works again.
    await page.unroute('**/api/upload')
    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: 'b.png', mimeType: 'image/png', buffer: makePng(32) })
    await expect(ed.body().locator('figure img')).toBeVisible({ timeout: 15_000 })
    await ctx.close()
  })

  test('an expired session during upload says so and keeps the work', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    await ctx.clearCookies()
    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: 'a.png', mimeType: 'image/png', buffer: makePng(32) })
    await expect(page.getByText('Upload failed:').first()).toBeVisible()
    await expect(page.getByText(/sign in/i).first()).toBeVisible()
    await expect(ed.body()).toContainText('Text before the image.')
    await ctx.close()
  })

  test('a pasted image is uploaded and replaced by its storage URL (never left as a data URI)', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    const dataUri = `data:image/png;base64,${makePng(40).toString('base64')}`
    await ed.moveToEnd()
    // A synthetic paste: real clipboards cannot be filled from a test, so this builds the
    // same ClipboardEvent a browser would fire for "copy an image from a web page".
    await page.evaluate((html) => {
      const dt = new DataTransfer()
      dt.setData('text/html', html)
      const root = document.querySelector('.tiptap-editor .ProseMirror') as HTMLElement
      root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, `<p>Pasted caption</p><img src="${dataUri}" alt="pasted">`)
    const img = ed.body().locator('img').last()
    await expect(img).toHaveAttribute('src', new RegExp(`^${storageBase()}/storage/v1/object/public/article-images/`), { timeout: 15_000 })
    const src = await img.getAttribute('src')
    const pasted = (await storedNamed('paste-image-')).find((o) => src!.endsWith(o.key.replace('article-images/', '')))
    expect(pasted, 'the pasted image is in storage').toBeTruthy()
    await expect(ed.body()).not.toContainText('data:image')
    const { id } = await ed.saveNow()
    expect(JSON.stringify((await articleByTitle((await page.getByPlaceholder('Your headline here...').inputValue())))!.content)).not.toContain('data:image')
    void id
    await ctx.close()
  })
})

test.describe('cover image', () => {
  test('uploaded from the document body: shown, saved, removable', async ({ browser }) => {
    const { ctx, page, ed, title } = await newArticle(browser)
    await chooseFileVia(page, () => page.getByRole('button', { name: 'Add cover image' }).click(), { name: 'cover.png', mimeType: 'image/png', buffer: makePng(80) })
    const cover = page.getByAltText('Cover', { exact: true })
    await expect(cover).toBeVisible({ timeout: 15_000 })
    const src = await cover.getAttribute('src')
    expect(src).toContain('/article-images/')

    const { id } = await ed.saveNow()
    expect((await articleByTitle(title))!.coverImage).toBe(src)
    await ed.openExisting(id)
    await expect(page.getByAltText('Cover', { exact: true })).toHaveAttribute('src', src!)

    // Remove it again and save.
    await page.getByRole('button', { name: 'Remove' }).first().click()
    await ed.saveNow()
    expect((await articleByTitle(title))!.coverImage).toBeNull()
    await ctx.close()
  })

  test('uploaded from the settings panel, and an invalid file shows its reason there', async ({ browser }) => {
    const { ctx, page, ed, title } = await newArticle(browser)
    const panel = page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') })

    await chooseFileVia(page, () => panel.getByRole('button', { name: 'Upload file' }).click(), { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
    await expect(panel.getByText(/File type not permitted/)).toBeVisible()
    await ed.saveNow()
    expect((await articleByTitle(title))!.coverImage).toBeNull()

    await chooseFileVia(page, () => panel.getByRole('button', { name: 'Upload file' }).click(), { name: 'cover2.png', mimeType: 'image/png', buffer: makePng(80) })
    await expect(panel.getByAltText('Cover preview')).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText(/File type not permitted/)).toHaveCount(0)
    await ed.saveNow()
    expect((await articleByTitle(title))!.coverImage).toContain('/article-images/')
    await ctx.close()
  })

  test('a pasted cover URL is saved as given', async ({ browser }) => {
    const { ctx, page, ed, title } = await newArticle(browser)
    const panel = page.locator('aside', { has: page.getByPlaceholder('Add a tag, press Enter...') })
    await panel.getByPlaceholder('https://...').fill('https://images.unsplash.com/photo-1?w=800')
    await ed.saveNow()
    expect((await articleByTitle(title))!.coverImage).toBe('https://images.unsplash.com/photo-1?w=800')
    await ctx.close()
  })
})

test.describe('who may upload (permission checks on the upload endpoint)', () => {
  const png = () => ({ name: 'p.png', mimeType: 'image/png', buffer: makePng(16) })

  test('signed-out callers are refused', async ({ browser }) => {
    const ctx = await signedIn(browser, null)
    const res = await ctx.request.post('/api/upload', { multipart: { file: png(), bucket: 'article-images' } })
    expect(res.status()).toBe(401)
    await ctx.close()
  })

  for (const who of ['reader', 'growth'] as const) {
    test(`${who} cannot upload article images`, async ({ browser }) => {
      const ctx = await signedIn(browser, who)
      const res = await ctx.request.post('/api/upload', { multipart: { file: { ...png(), name: `${who}-attempt.png` }, bucket: 'article-images' } })
      expect(res.status(), await res.text()).toBe(403)
      expect(await storedNamed(`${who}-attempt`)).toHaveLength(0)
      await ctx.close()
    })
  }

  test('an unknown bucket is refused for a writer', async ({ browser }) => {
    const ctx = await signedIn(browser, 'writer')
    const res = await ctx.request.post('/api/upload', { multipart: { file: png(), bucket: 'secrets' } })
    expect(res.status()).toBe(400)
    await ctx.close()
  })
})
