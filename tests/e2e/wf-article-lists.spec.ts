import { test, expect, type Page } from '@playwright/test'
import { closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signInAs, signedIn, uniqueTitle, withCookieConsentAnswered, type TestAccount } from './helpers/workflow'

/**
 * The two article lists and their cover images: the editorial All Articles list and the public
 * archive. Each is checked with an article whose cover exists, one with no cover and one whose
 * cover cannot be loaded, because a list that only works when every picture loads is how the
 * images went missing in the first place.
 *
 * `/team/sam-hunt.png` is a real file served by the app (the launcher gives seeded articles the
 * same cover), so the browser really decodes it; the "broken" address is one that returns 404.
 */
test.describe.configure({ mode: 'serial' })

const REAL_COVER = '/team/sam-hunt.png'
const BROKEN_COVER = '/team/wf-article-lists-no-such-file.png'
const MARK = uniqueTitle('lists')
const WITH_COVER = `${MARK} with cover`
const NO_COVER = `${MARK} no cover`
const BROKEN = `${MARK} broken cover`
const DRAFT = `${MARK} draft`
const TOPIC = `${MARK} Topic`
const topicSlug = TOPIC.toLowerCase().replace(/[^a-z0-9]+/g, '-')

let writer: TestAccount
let tagId = ''

/** True once the row's picture has been fetched and decoded (lazy pictures load when scrolled to). */
async function coverLoaded(scope: ReturnType<Page['locator']>) {
  await scope.scrollIntoViewIfNeeded()
  await expect.poll(() => scope.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
}

test.beforeAll(async () => {
  writer = await createAccount('WRITER', 'lists')
  const category = await db().category.findUniqueOrThrow({ where: { slug: 'analysis' } })
  tagId = (await db().tag.create({ data: { name: TOPIC, slug: topicSlug } })).id
  const base = { content: '<p>Article list fixture.</p>', authorId: writer.id, categoryId: category.id }
  const published = (n: number) => ({ status: 'PUBLISHED' as const, publishedAt: new Date(Date.now() - n * 60_000) })
  await db().article.create({ data: { ...base, ...published(1), title: WITH_COVER, slug: `${topicSlug}-with-cover`, excerpt: 'Standfirst of the article with a cover.', coverImage: REAL_COVER, tags: { create: [{ tagId }] } } })
  await db().article.create({ data: { ...base, ...published(2), title: NO_COVER, slug: `${topicSlug}-no-cover`, coverImage: null } })
  await db().article.create({ data: { ...base, ...published(3), title: BROKEN, slug: `${topicSlug}-broken-cover`, coverImage: BROKEN_COVER } })
  await db().article.create({ data: { ...base, title: DRAFT, slug: `${topicSlug}-draft`, status: 'DRAFT', coverImage: REAL_COVER } })
})

test.afterAll(async () => {
  await removeMyArticles()
  if (tagId) await db().tag.deleteMany({ where: { id: tagId } })
  await removeMyAccounts()
  await closeDb()
})

test('the editorial list shows each cover, says when one is missing or broken, and finds articles by search', async ({ browser }) => {
  const ctx = await withCookieConsentAnswered(await signedIn(browser, 'editor'))
  const page = await ctx.newPage()
  const row = (title: string) => page.getByRole('row').filter({ hasText: title })
  await page.goto('/editorial/articles', { waitUntil: 'networkidle' })

  // Search by the marker: title search, and the status tabs count what the search leaves.
  await page.getByRole('searchbox', { name: 'Search articles by title, author or tag' }).fill(MARK)
  await expect(page.getByRole('row')).toHaveCount(5) // header + the four fixtures
  await expect(page.getByRole('button', { name: /^All\d+$/ })).toHaveText('All4')
  await expect(page.getByRole('button', { name: /^PUBLISHED\d+$/ })).toHaveText('PUBLISHED3')

  // The article's own cover is drawn, cropped to the same landscape box as every other row.
  await coverLoaded(row(WITH_COVER))
  const box = (await row(WITH_COVER).locator('img').boundingBox())!
  expect(box.width / box.height).toBeCloseTo(1.5, 1)
  await coverLoaded(row(DRAFT))
  await expect(row(NO_COVER).locator('img')).toHaveCount(0)
  await expect(row(NO_COVER).getByText('No cover image')).toBeAttached()
  await expect(row(BROKEN).getByText('Cover image could not be loaded')).toBeAttached()
  await expect(row(BROKEN).locator('img')).toHaveCount(0)

  // Author, format, tag, status and date are on the row.
  await expect(row(WITH_COVER)).toContainText(writer.name)
  await expect(row(WITH_COVER)).toContainText('Analysis')
  await expect(row(WITH_COVER).getByRole('list', { name: 'Tags' })).toContainText(TOPIC)
  await expect(row(WITH_COVER)).toContainText('PUBLISHED')
  await expect(row(WITH_COVER)).toContainText(/Published \d{1,2} \w+ \d{4}/)

  // Search also matches the tag and the author; filters narrow it; "without a cover" finds both gaps.
  await page.getByRole('searchbox').fill(`${TOPIC}`)
  await expect(page.getByRole('row')).toHaveCount(2)
  await page.getByRole('searchbox').fill(MARK)
  await page.getByRole('button', { name: /^DRAFT\d+$/ }).click()
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(row(DRAFT)).toBeVisible()
  await page.getByRole('button', { name: /^All\d+$/ }).click()
  await page.getByRole('checkbox', { name: /Without a cover image/ }).check()
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(row(NO_COVER)).toBeVisible()
  await page.getByRole('checkbox', { name: /Without a cover image/ }).uncheck()

  // Sorting by title puts the four fixtures in alphabetical order.
  await page.getByRole('combobox', { name: 'Sort articles' }).selectOption('title')
  await expect(page.getByRole('row').nth(1)).toContainText(BROKEN)

  // Every management action is still on a published row, and the headline opens the editor.
  const published = row(WITH_COVER)
  for (const name of ['Unpublish', 'Pin to category', 'Delete article']) await expect(published.getByRole('button', { name, exact: true })).toBeVisible()
  for (const name of ['Corrections', 'Edit', 'View live article', 'Manage homepage carousel in article editor']) await expect(published.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(published.getByRole('link', { name: WITH_COVER, exact: true })).toHaveAttribute('href', /\/editorial\/articles\/[^/]+\/edit$/)
  await ctx.close()
})

test('a writer sees only their own articles, with covers, and none of the publishing controls', async ({ browser }) => {
  const ctx = await withCookieConsentAnswered(await signInAs(browser, writer))
  const page = await ctx.newPage()
  await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'My Articles' })).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(5)
  const row = (title: string) => page.getByRole('row').filter({ hasText: title })
  await coverLoaded(row(WITH_COVER))
  for (const name of ['Publish', 'Unpublish', 'Pin to category']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Corrections', exact: true })).toHaveCount(0)
  // Only what a writer may still edit can be trashed: the draft, not the published articles.
  await expect(row(DRAFT).getByRole('button', { name: 'Delete article' })).toBeVisible()
  await expect(row(WITH_COVER).getByRole('button', { name: 'Delete article' })).toHaveCount(0)
  await ctx.close()
})

for (const width of [375, 768, 1440]) {
  test(`the editorial list fits a ${width}px screen without sideways scrolling`, async ({ browser }) => {
    const ctx = await withCookieConsentAnswered(await signedIn(browser, 'editor'))
    const page = await ctx.newPage()
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/editorial/articles', { waitUntil: 'networkidle' })
    await page.getByRole('searchbox').fill(MARK)
    const row = page.getByRole('row').filter({ hasText: WITH_COVER })
    await coverLoaded(row)
    // Every control on the row is inside the viewport: nothing is pushed off the side.
    for (const control of [row.getByRole('link', { name: 'Edit', exact: true }), row.getByRole('button', { name: 'Delete article' })]) {
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await ctx.close()
  })
}

for (const width of [375, 768, 1440]) {
  test(`the public archive shows covers, fallbacks, excerpt, author and topic at ${width}px`, async ({ browser }) => {
    const ctx = await withCookieConsentAnswered(await signedIn(browser, null))
    const page = await ctx.newPage()
    await page.setViewportSize({ width, height: 900 })
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))

    // Filtered to this spec's topic and marker, so other suites' articles cannot move the rows.
    await page.goto(`/archive?q=${encodeURIComponent(MARK)}`, { waitUntil: 'networkidle' })
    const item = (title: string) => page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    await expect(page.locator('article')).toHaveCount(3) // the draft is not public

    await coverLoaded(item(WITH_COVER))
    const box = (await item(WITH_COVER).locator('img').boundingBox())!
    expect(box.width / box.height, 'landscape 3:2 crop').toBeCloseTo(1.5, 1)
    // No cover and a failed cover both leave the placeholder, never a broken-image icon.
    await expect(item(NO_COVER).locator('img')).toHaveCount(0)
    await expect(item(BROKEN).locator('img')).toHaveCount(0)
    for (const title of [NO_COVER, BROKEN]) {
      const placeholder = (await item(title).locator('.archive-cover').boundingBox())!
      expect(placeholder.width / placeholder.height).toBeCloseTo(1.5, 1)
    }

    // One link to the article per row (the headline), plus author, format and topic links.
    await expect(item(WITH_COVER).locator(`a[href="/articles/${topicSlug}-with-cover"]`)).toHaveCount(1)
    await expect(item(WITH_COVER).getByRole('link', { name: writer.name })).toHaveAttribute('href', /^\/author\//)
    await expect(item(WITH_COVER).getByRole('link', { name: 'Analysis', exact: true })).toHaveAttribute('href', '/category/analysis')
    await expect(item(WITH_COVER).getByRole('link', { name: TOPIC, exact: true })).toHaveAttribute('href', `/tag/${topicSlug}`)
    await expect(item(WITH_COVER).locator('time')).toHaveText(/\d{1,2} \w+ \d{4}/)
    if (width >= 640) await expect(item(WITH_COVER)).toContainText('Standfirst of the article with a cover.')

    // The picture and the space around the text open the article, not only the headline text.
    const cover = (await item(WITH_COVER).locator('.archive-cover').boundingBox())!
    await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2)
    await expect(page).toHaveURL(new RegExp(`/articles/${topicSlug}-with-cover$`))
    await page.goBack()

    // The active filter is shown as a removable chip; removing it returns to the whole archive.
    await page.getByRole('link', { name: `Remove filter “${MARK}”` }).click()
    await expect(page).toHaveURL(/\/archive$/)
    await expect(page.getByPlaceholder('Search articles...')).toHaveValue('')

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(failures).toEqual([])
    await ctx.close()
  })
}

test('archive search and topic filters work from the form, and a topic row link reaches the topic page', async ({ browser }) => {
  const ctx = await withCookieConsentAnswered(await signedIn(browser, null))
  const page = await ctx.newPage()
  await page.goto('/archive', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Archive' })).toBeVisible()

  await page.getByPlaceholder('Search articles...').fill(MARK)
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page).toHaveURL(/[?&]q=/)
  await expect(page.locator('article')).toHaveCount(3)
  await expect(page.getByText(/^3 articles/)).toBeVisible()

  // Narrow to the topic: only the tagged article is left, and the topic stays ticked.
  const topics = page.locator('details.archive-topics')
  if (!(await topics.evaluate((el: HTMLDetailsElement) => el.open))) await topics.locator('summary').click()
  await page.getByRole('checkbox', { name: TOPIC, exact: true }).check()
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`tag=${topicSlug}`))
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.getByRole('checkbox', { name: TOPIC, exact: true })).toBeChecked()

  await page.getByRole('link', { name: 'Clear all filters', exact: true }).click()
  await expect(page).toHaveURL(/\/archive$/)
  // The form is reset with the URL: nothing stays typed or ticked from the cleared search.
  await expect(page.getByPlaceholder('Search articles...')).toHaveValue('')

  await page.goto(`/archive?q=${encodeURIComponent(MARK)}`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: TOPIC, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/tag/${topicSlug}$`))
  await expect(page.getByRole('heading', { name: WITH_COVER, exact: true })).toBeVisible()
  await ctx.close()
})
