import { test, expect, type Page } from '@playwright/test'
import { ArticleEditorPage, articleByTitle, closeDb, confirmPublicChange, removeMyArticles, signedIn, storedObjects, uniqueTitle } from './helpers/workflow'
import { makePng } from './helpers/e2eUtils'

const MAX_BYTES = 4 * 1024 * 1024 // MAX_SERVER_UPLOAD_BYTES

/** A real, decodable PNG padded with trailing zero bytes to exactly `total` bytes. */
function pngOfSize(total: number): Buffer {
  const png = makePng(48)
  return Buffer.concat([png, Buffer.alloc(Math.max(0, total - png.length))])
}

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
/** Managed names are opaque; verify the actual URL and all storage side effects. */
const imageKeys = async () => (await articleImages()).map(object => object.key).sort()
const storedForUrl = async (src: string) => {
  const url = new URL(src)
  expect(url.origin).toBe(new URL(storageBase()).origin)
  expect(url.pathname).toMatch(/^\/storage\/v1\/object\/public\/article-images\/[^/]+\/[a-f0-9-]{36}\.png$/)
  const key = url.pathname.replace('/storage/v1/object/public/', '')
  const matches = (await articleImages()).filter(object => object.key === key)
  expect(matches).toHaveLength(1)
  return matches[0]
}

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
    const session = await (await ctx.request.get('/api/auth/session')).json()
    expect(src).toContain(`/article-images/${session.user.id}/`)
    const stored = await storedForUrl(src!)
    expect(stored.type).toBe('image/png')
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
    const keysBefore = await imageKeys()
    await chooseFileVia(page, () => ed.tool('Insert image').click(), {
      name: 'invoice.png', // an image name on a non-image file
      mimeType: 'image/png',
      buffer: Buffer.from('this is plain text, not a PNG'),
    })
    await expect(page.getByText('Upload failed:')).toBeVisible()
    await expect(page.getByText(/File type not permitted/)).toBeVisible()
    await expect(ed.body().locator('figure')).toHaveCount(0)
    expect(await imageKeys()).toEqual(keysBefore)
    await expect(ed.body()).toContainText('Text before the image.')
    await ctx.close()
  })

  // The limit comes from the platform: Vercel rejects a Function request body over 4.5 MB before our
  // code runs, with a bare 413. The app therefore caps files at 4 MiB (MAX_SERVER_UPLOAD_BYTES) in the
  // browser AND on the server. These tests pin the boundary on both sides.
  test('an image exactly at the limit uploads, renders, and still renders after reopening and publishing', async ({ browser }) => {
    const { ctx, page, ed, title } = await newArticle(browser, 'editor')
    const stamp = Date.now().toString(36)
    await chooseFileVia(page, () => ed.tool('Insert image').click(), {
      name: `edge ${stamp}.png`, mimeType: 'image/png', buffer: pngOfSize(MAX_BYTES),
    })
    const img = ed.body().locator('figure.article-figure img')
    await expect(img).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
    const stored = await storedForUrl((await img.getAttribute('src'))!)
    await ed.body().getByLabel('Alternative text', { exact: true }).fill('Solid red chart at the upload size limit')
    expect(stored.size, 'the exact bytes were stored').toBe(MAX_BYTES)

    const { id } = await ed.saveNow()
    await ed.openExisting(id)
    const reopened = ed.body().locator('figure.article-figure img')
    await expect(reopened).toBeVisible()
    await expect.poll(() => reopened.evaluate((i: HTMLImageElement) => i.naturalWidth), { message: 'image renders after reopening' }).toBeGreaterThan(0)

    // Publish it and check the reader's page renders the same image.
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await confirmPublicChange(page, 'Publish now')
    await expect.poll(async () => (await articleByTitle(title))!.status).toBe('PUBLISHED')
    const anon = await signedIn(browser, null)
    const pub = await anon.newPage()
    await pub.goto(`/articles/${(await articleByTitle(title))!.slug}`, { waitUntil: 'networkidle' })
    const publicImg = pub.locator('.prose-consilium figure img')
    await expect(publicImg).toBeVisible()
    expect(await publicImg.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
    await anon.close()
    await ctx.close()
  })

  test('one byte over the limit is refused in the browser with a persistent, specific message and nothing is sent', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    const keysBefore = await imageKeys()
    const uploads: string[] = []
    page.on('request', (r) => { if (r.url().includes('/api/upload')) uploads.push(r.url()) })
    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: 'huge.png', mimeType: 'image/png', buffer: pngOfSize(MAX_BYTES + 1) })
    await expect(page.getByText(/File too large \(max 4 MB\)/)).toBeVisible()
    // It stays until dismissed (it used to vanish after four seconds), wherever the page is scrolled.
    await page.waitForTimeout(5_000)
    await expect(page.getByText(/File too large \(max 4 MB\)/)).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss upload error' }).click()
    await expect(page.getByText('Upload failed:')).toHaveCount(0)
    await expect(ed.body().locator('figure')).toHaveCount(0)
    expect(await imageKeys()).toEqual(keysBefore)
    expect(uploads, 'an oversized file must be refused before it is sent').toEqual([])
    await ctx.close()
  })

  test('the server enforces the same limit for a client that skips the browser check', async ({ browser }) => {
    const ctx = await signedIn(browser, 'writer')
    const keysBefore = await imageKeys()
    const over = await ctx.request.post('/api/upload', {
      multipart: { file: { name: 'over-limit.png', mimeType: 'image/png', buffer: pngOfSize(MAX_BYTES + 1) }, bucket: 'article-images' },
    })
    expect(over.status()).toBe(413)
    expect((await over.json()).error).toMatch(/File too large \(max 4 MB\)/)

    // A body far past the limit is refused from its declared length, before it is parsed.
    const way = await ctx.request.post('/api/upload', {
      multipart: { file: { name: 'way-over.png', mimeType: 'image/png', buffer: pngOfSize(MAX_BYTES + 512 * 1024) }, bucket: 'article-images' },
    })
    expect(way.status()).toBe(413)
    expect(await imageKeys()).toEqual(keysBefore)

    const ok = await ctx.request.post('/api/upload', {
      multipart: { file: { name: 'at-limit-api.png', mimeType: 'image/png', buffer: pngOfSize(MAX_BYTES) }, bucket: 'article-images' },
    })
    expect(ok.status(), await ok.text()).toBe(201)
    await ctx.close()
  })

  test('the avatar bucket has the same server limit', async ({ browser }) => {
    const ctx = await signedIn(browser, 'reader')
    const over = await ctx.request.post('/api/upload', {
      multipart: { file: { name: 'avatar-over.png', mimeType: 'image/png', buffer: pngOfSize(MAX_BYTES + 1) }, bucket: 'avatars' },
    })
    expect(over.status()).toBe(413)
    await ctx.close()
  })

  test('a platform 413 (Vercel cutting the body off) is explained, not shown as a raw failure', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    await page.route('**/api/upload', (route) => route.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large' }))
    await chooseFileVia(page, () => ed.tool('Insert image').click(), { name: 'a.png', mimeType: 'image/png', buffer: makePng(32) })
    await expect(page.getByText('Upload failed:').first()).toBeVisible()
    await expect(page.getByText(/too large for the server/i)).toBeVisible()
    await expect(ed.body()).toContainText('Text before the image.')
    await ctx.close()
  })

  test('a pasted image at the limit uploads; one over is refused with the reason and not inserted', async ({ browser }) => {
    const { ctx, page, ed } = await newArticle(browser)
    const paste = (bytes: number) => page.evaluate((html) => {
      const dt = new DataTransfer()
      dt.setData('text/html', html)
      document.querySelector('.tiptap-editor .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, `<p>Pasted</p><img src="data:image/png;base64,${pngOfSize(bytes).toString('base64')}" alt="p">`)

    await ed.moveToEnd()
    await paste(MAX_BYTES + 1)
    await expect(page.getByText(/File too large \(max 4 MB\)/)).toBeVisible({ timeout: 30_000 })
    await expect(ed.body().locator('img')).toHaveCount(0)
    await page.getByRole('button', { name: 'Dismiss upload error' }).click()

    await ed.moveToEnd()
    await paste(MAX_BYTES)
    await expect(ed.body().locator('img').last()).toHaveAttribute('src', new RegExp(`^${storageBase()}/storage/v1/object/public/article-images/`), { timeout: 30_000 })
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
    await storedForUrl(src!)
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
      const keysBefore = await imageKeys()
      const res = await ctx.request.post('/api/upload', { multipart: { file: { ...png(), name: `${who}-attempt.png` }, bucket: 'article-images' } })
      expect(res.status(), await res.text()).toBe(403)
      expect(await imageKeys()).toEqual(keysBefore)
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


test('an interrupted image upload is visible and retry saves a single figure that reopens', async ({ browser }) => {
  const t = await newArticle(browser)
  const keysBefore = await imageKeys()
  const name = `interrupted-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  await t.page.route('**/api/upload', route => route.abort('connectionreset'))
  await chooseFileVia(t.page, () => t.ed.tool('Insert image').click(), { name, mimeType: 'image/png', buffer: makePng(32) })
  await expect(t.page.getByText('Upload failed:')).toBeVisible()
  await expect(t.ed.body()).toContainText('Text before the image.')
  await expect(t.ed.body().locator('figure')).toHaveCount(0)
  expect(await imageKeys()).toEqual(keysBefore)
  await t.page.unroute('**/api/upload')
  const response = t.page.waitForResponse(r => r.url().endsWith('/api/upload') && r.request().method() === 'POST')
  await chooseFileVia(t.page, () => t.ed.tool('Insert image').click(), { name, mimeType: 'image/png', buffer: makePng(32) })
  expect((await response).status()).toBe(201)
  await expect(t.ed.body().locator('figure img')).toBeVisible()
  const src = await t.ed.body().locator('figure img').getAttribute('src')
  const { id } = await t.ed.saveNow()
  await t.ed.openExisting(id)
  await expect(t.ed.body().locator('figure img')).toHaveAttribute('src', src!)
  await expect(t.ed.body()).toContainText('Text before the image.')
  await storedForUrl(src!)
  expect((await imageKeys()).filter(key => !keysBefore.includes(key))).toHaveLength(1)
  expect((await articleByTitle(t.title))!.status).toBe('DRAFT')
  await t.ctx.close()
})
