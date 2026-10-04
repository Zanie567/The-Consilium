import { test, expect, type Page, type Locator } from '@playwright/test'
import { ArticleEditorPage, closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signedIn, uniqueTitle } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'
import { CONTACT_EMAIL, INSTAGRAM_URL, LINKEDIN_URL, FEEDBACK_FORM_URL } from '../../src/lib/constants'

const ownedSeries: string[] = []
const ownedTags: string[] = []
test.afterAll(async () => {
  await removeMyArticles(); await removeMyAccounts()
  await db().series.deleteMany({ where: { id: { in: ownedSeries } } })
  await db().tag.deleteMany({ where: { id: { in: ownedTags } } })
  await closeDb()
})
const nav = [
  ['Home', '/', 'The Consilium'], ['News', '/category/news', 'News'], ['Opinion', '/category/opinion', 'Opinion'],
  ['Analysis', '/category/analysis', 'Analysis'], ['Interviews', '/category/interviews', 'Interviews'],
  ['Debate', '/opinion-debate', 'Opinion Debate'], ['About', '/about', 'About'],
]
async function arrived(page: Page, path: string, heading: string) {
  await expect(page).toHaveURL(new URL(path, page.url()).href)
  await expect(page.locator('main h1')).toHaveText(heading)
}
async function popup(page: Page, link: Locator, destination: string) {
  const target = new URL(destination).href
  expect(new URL((await link.getAttribute('href'))!).href).toBe(target)
  // Capture only this external transport boundary; the provider receives no request.
  await page.context().route(url => url.href === target, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Controlled external destination</h1>' }))
  const opened = page.context().waitForEvent('page')
  const response = page.context().waitForEvent('response', { predicate: response => response.url() === target })
  await link.click()
  const child = await opened
  expect((await response).status()).toBe(200)
  await expect(child).toHaveURL(target)
  await expect(child.getByRole('heading', { name: 'Controlled external destination' })).toBeVisible()
  await child.close()
}

test('every desktop header and footer destination, static call to action and captured external link activates', async ({ browser }) => {
  test.setTimeout(180_000) // 21 internal controls plus static links and captured popups; normal action/nav deadlines remain.
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  expect((await page.goto('/', { waitUntil: 'networkidle' }))?.status()).toBe(200)
  await new ArticleEditorPage(page).dismissCookieBanner()
  for (const [label, path, heading] of nav) {
    await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: label, exact: true }).click()
    await arrived(page, path, heading)
  }
  const footer = page.locator('footer')
  for (const [label, path, heading] of [...nav.slice(1, 6), ['Archive', '/archive', 'Archive'], ['About Us', '/about', 'About'], ['Our Team', '/team', 'Our Team'], ['Contact', '/contact', 'Contact'], ['Corrections Policy', '/corrections', 'Corrections Policy'], ['Privacy Policy', '/privacy', 'Privacy Policy'], ['Terms of Service', '/terms', 'Terms of Service'], ['Search', '/search', 'Search'], ['The Consilium', '/', 'The Consilium']]) {
    await footer.getByRole('link', { name: label, exact: true }).click()
    await arrived(page, path, heading)
  }
  for (const [label, destination] of [['Follow The Consilium on Instagram', INSTAGRAM_URL], ['Connect with The Consilium on LinkedIn', LINKEDIN_URL], ['Share Your Feedback', FEEDBACK_FORM_URL]]) {
    await popup(page, footer.getByRole('link', { name: label, exact: true }), destination)
  }
  await page.evaluate(() => document.addEventListener('click', event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="mailto:"]')
    if (link) { event.preventDefault(); document.documentElement.dataset.mailto = link.href }
  }, true))
  await footer.getByRole('link', { name: 'Email The Consilium', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-mailto', `mailto:${CONTACT_EMAIL}`)
  await footer.getByRole('link', { name: 'About Us', exact: true }).click()
  await arrived(page, '/about', 'About')
  await page.locator('main').getByRole('link', { name: 'Contact Us', exact: true }).click()
  await arrived(page, '/contact', 'Contact')
  await footer.getByRole('link', { name: 'About Us', exact: true }).click()
  await page.locator('main').getByRole('link', { name: 'Meet the Team', exact: true }).click()
  await arrived(page, '/team', 'Our Team')
  await footer.getByRole('link', { name: 'Corrections Policy', exact: true }).click()
  const correctionEmail = page.locator('main a[href^="mailto:"][href*="subject="]')
  await correctionEmail.click()
  await expect(page.locator('html')).toHaveAttribute('data-mailto', `mailto:${CONTACT_EMAIL}?subject=Correction%20Request`)
  for (const destination of ['/contact', '/']) {
    await page.locator(`main a[href="${destination}"]`).click()
    await arrived(page, destination, destination === '/' ? 'The Consilium' : 'Contact')
    if (destination === '/contact') await footer.getByRole('link', { name: 'Corrections Policy', exact: true }).click()
  }
  await footer.getByRole('link', { name: 'Terms of Service', exact: true }).click()
  for (const [destination, heading] of [['/corrections', 'Corrections Policy'], ['/privacy', 'Privacy Policy'], ['/', 'The Consilium']]) {
    await page.locator(`main a[href="${destination}"]`).click()
    await arrived(page, destination, heading)
    if (destination !== '/') await footer.getByRole('link', { name: 'Terms of Service', exact: true }).click()
  }
  await footer.getByRole('link', { name: 'Privacy Policy', exact: true }).click()
  await popup(page, page.locator('main a[href="https://ico.org.uk"]'), 'https://ico.org.uk/')
  await page.locator('main a[href="/"]').click()
  await arrived(page, '/', 'The Consilium')
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})

test('header search opens, closes, retains an empty query and submits a real search result', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  await page.locator('header').getByRole('button', { name: 'Search', exact: true }).click()
  const input = page.getByPlaceholder('Search articles, authors, topics…')
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: 'Close search', exact: true }).click()
  await expect(input).toBeHidden()
  await page.locator('header').getByRole('button', { name: 'Search', exact: true }).click()
  await input.locator('..').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page).toHaveURL(new URL('/', page.url()).href)
  await expect(input).toBeVisible()
  const searched = page.waitForResponse(r => new URL(r.url()).pathname === '/api/search' && new URL(r.url()).searchParams.get('q') === 'carbon')
  await input.fill('carbon')
  await input.press('Enter')
  expect((await searched).status()).toBe(200)
  await expect(page).toHaveURL(new URL('/search?q=carbon', page.url()).href)
  const result = await db().article.findFirstOrThrow({ where: { title: { contains: 'carbon', mode: 'insensitive' }, status: 'PUBLISHED', deletedAt: null } })
  await page.locator(`main a[href="/articles/${result.slug}"]`).first().click()
  await arrived(page, `/articles/${result.slug}`, result.title)
  await ctx.close()
})

test('anonymous phone drawer closes with its button, backdrop and Escape; every route link navigates and unlocks scrolling', async ({ browser }) => {
  test.setTimeout(90_000)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const menu = page.getByRole('navigation', { name: 'Mobile navigation' })
  const drawer = menu.locator('..')
  for (const close of ['button', 'Escape', 'backdrop']) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    await expect(menu).toBeVisible()
    expect(await page.locator('body').evaluate(el => el.style.overflow)).toBe('hidden')
    if (close === 'button') await drawer.getByRole('button', { name: 'Close menu', exact: true }).click()
    else if (close === 'Escape') await page.keyboard.press('Escape')
    else await page.mouse.click(10, 400)
    await expect(menu).toBeHidden()
    expect(await page.locator('body').evaluate(el => el.style.overflow)).toBe('')
  }
  for (const [label, path, heading] of nav) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    await menu.getByRole('link', { name: label, exact: true }).click()
    await arrived(page, path, heading)
    await expect(menu).toBeHidden()
    expect(await page.locator('body').evaluate(el => el.style.overflow)).toBe('')
  }
  await page.getByRole('button', { name: 'Open menu', exact: true }).click()
  await drawer.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new URL('/login', page.url()).href)
  await expect(page.locator('input[type=email]')).toBeVisible()
  await ctx.close()
})

test('signed-in phone reader opens Profile and signs out; writer shortcuts open Dashboard and New Article', async ({ browser }) => {
  test.setTimeout(90_000)
  for (const role of ['reader', 'writer'] as const) {
    const seed = await signedIn(browser, role)
    const storageState = await seed.storageState()
    await seed.close()
    const ctx = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    const drawer = page.getByRole('navigation', { name: 'Mobile navigation' }).locator('..')
    if (role === 'writer') {
      await drawer.getByRole('link', { name: 'Dashboard', exact: true }).click()
      await expect(page).toHaveURL(new URL('/editorial', page.url()).href)
      await expect(page.getByRole('navigation', { name: 'Editorial navigation' })).toBeVisible()
      await page.goto('/', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Open menu', exact: true }).click()
      await drawer.getByRole('link', { name: 'New Article', exact: true }).click()
      await expect(new ArticleEditorPage(page).body()).toBeVisible()
    } else {
      await expect(drawer.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0)
      await expect(drawer.getByRole('link', { name: 'New Article', exact: true })).toHaveCount(0)
      await drawer.getByRole('link', { name: 'Profile', exact: true }).click()
      await expect(page).toHaveURL(new URL('/profile', page.url()).href)
      await expect(page.getByRole('button', { name: 'Account Settings', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Open menu', exact: true }).click()
      const signedOut = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/signout' && r.request().method() === 'POST')
      await drawer.getByRole('button', { name: 'Sign out', exact: true }).click()
      expect((await signedOut).status()).toBe(200)
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: 'Open menu', exact: true }).click()
      await expect(drawer.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    }
    await ctx.close()
  }
})

test('article section links, author/category/tag filters, series edges and related cards navigate representative records', async ({ browser, browserName }) => {
  test.setTimeout(120_000)
  const author = await createAccount('WRITER', 'public-controls')
  const authorSlug = (await db().user.findUniqueOrThrow({ where: { id: author.id } })).slug!
  const categories = await db().category.findMany({ orderBy: { name: 'asc' }, take: 2 })
  expect(categories).toHaveLength(2)
  const prefix = uniqueTitle('Public control series')
  const slug = (text: string) => text.toLowerCase().replaceAll(' ', '-')
  const series = await db().series.create({ data: { title: prefix, slug: slug(prefix) } })
  ownedSeries.push(series.id)
  const tag = await db().tag.create({ data: { name: prefix, slug: slug(prefix) } })
  ownedTags.push(tag.id)
  const articles = []
  // Sparse stored ordering and an unpublished member must not distort public part numbers.
  for (const [index, order] of [1, 3, 5, 2].entries()) {
    const title = `${prefix} article ${index}`
    articles.push(await db().article.create({ data: { title, slug: slug(title), authorId: author.id, categoryId: categories[index === 2 ? 1 : 0].id, seriesId: series.id, seriesOrder: order, status: index === 3 ? 'DRAFT' : 'PUBLISHED', publishedAt: index === 3 ? null : new Date(), content: '<h2>Repeated section</h2><p>First section body.</p><h2>Repeated section</h2><p>Second section body.</p>', tags: { create: { tagId: tag.id } } } }))
  }
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)
  const middle = `/articles/${articles[1].slug}`
  expect((await page.goto(middle, { waitUntil: 'networkidle' }))?.status()).toBe(200)
  await new ArticleEditorPage(page).dismissCookieBanner()
  await expect(page.getByText('Part 2 of 3', { exact: true })).toBeVisible()
  const headings = page.locator('#article-body h2')
  await expect(headings.nth(0)).toHaveAttribute('id', 'repeated-section')
  await expect(headings.nth(1)).toHaveAttribute('id', 'repeated-section-2')
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Controlled section clipboard denial') } } }))
  await headings.nth(0).hover()
  await page.getByRole('link', { name: 'Link to section: Repeated section', exact: true }).nth(0).click()
  await expect(page).toHaveURL(new URL(`${middle}#repeated-section`, page.url()).href)
  await expect(page.getByRole('alert').filter({ hasText: 'Section link could not be copied.' })).toBeVisible()
  await page.evaluate(() => Reflect.deleteProperty(navigator, 'clipboard'))
  if (browserName === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
  await headings.nth(1).hover()
  await page.getByRole('link', { name: 'Link to section: Repeated section', exact: true }).nth(1).click()
  await expect(page).toHaveURL(new URL(`${middle}#repeated-section-2`, page.url()).href)
  await expect(page.getByRole('status').filter({ hasText: 'Section link copied.' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Section link could not be copied.' })).toHaveCount(0)
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url())
  await page.locator(`main a[href="/author/${authorSlug}"]`).first().click()
  await arrived(page, `/author/${authorSlug}`, author.name)
  for (const [index, category] of categories.entries()) {
    await page.locator(`main a[href="/author/${authorSlug}?category=${category.slug}"]`).click()
    await expect(page).toHaveURL(new URL(`/author/${authorSlug}?category=${category.slug}`, page.url()).href)
    await expect(page.locator('main a[href^="/articles/"]')).toHaveCount(index === 0 ? 2 : 1)
    await expect(page.locator(`main a[href="/articles/${articles[3].slug}"]`)).toHaveCount(0)
  }
  await page.locator('main').getByRole('link', { name: 'All', exact: true }).click()
  await expect(page.locator('main a[href^="/articles/"]')).toHaveCount(3)
  await page.locator(`main a[href="${middle}"]`).click()
  await arrived(page, middle, articles[1].title)
  await page.getByRole('link', { name: prefix, exact: true }).click()
  await arrived(page, `/tag/${tag.slug}`, tag.name)
  await expect(page.locator('main article a[aria-label]')).toHaveCount(3)
  await expect(page.locator(`main a[href="/articles/${articles[3].slug}"]`)).toHaveCount(0)
  await page.locator(`main article a[href="${middle}"]`).click()
  await arrived(page, middle, articles[1].title)
  await page.getByRole('link', { name: new RegExp(`Next.*${articles[2].title}`) }).click()
  await arrived(page, `/articles/${articles[2].slug}`, articles[2].title)
  await expect(page.getByText('Part 3 of 3', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Next →/ })).toHaveCount(0)
  await page.getByRole('link', { name: new RegExp(`Previous.*${articles[1].title}`) }).click()
  await arrived(page, middle, articles[1].title)
  await page.getByRole('link', { name: new RegExp(`Previous.*${articles[0].title}`) }).click()
  await arrived(page, `/articles/${articles[0].slug}`, articles[0].title)
  await expect(page.getByText('Part 1 of 3', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^← Previous/ })).toHaveCount(0)
  const related = page.getByRole('heading', { name: 'Continue Reading', exact: true }).locator('..').locator('..').locator('..').getByRole('link', { name: articles[1].title, exact: true })
  await related.click()
  await arrived(page, middle, articles[1].title)
  await page.getByRole('link', { name: '← Back to Homepage', exact: true }).click()
  await arrived(page, '/', 'The Consilium')
  expect(errors, errors.join('\n')).toEqual([])
  await ctx.close()
})
