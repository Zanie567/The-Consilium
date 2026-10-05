import { test, expect, type Page, type Locator } from '@playwright/test'
import { ArticleEditorPage, closeDb, createAccount, db, removeMyAccounts, removeMyArticles, signedIn, signInAs, uniqueTitle } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'
import { CONTACT_EMAIL, INSTAGRAM_URL, LINKEDIN_URL, FEEDBACK_FORM_URL } from '../../src/lib/constants'

const ownedSeries: string[] = []
const ownedTags: string[] = []
const ownedTerms: string[] = []
test.afterAll(async () => {
  await removeMyArticles(); await removeMyAccounts()
  await db().series.deleteMany({ where: { id: { in: ownedSeries } } })
  await db().tag.deleteMany({ where: { id: { in: ownedTags } } })
  await db().glossaryTerm.deleteMany({ where: { id: { in: ownedTerms } } })
  await closeDb()
})
const paragraphs = (text: string, count = 1) => JSON.stringify({ type: 'doc', content: Array.from({ length: count }, () => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })
const nav = [
  ['Home', '/', 'The Consilium'], ['News', '/category/news', 'News'], ['Opinion', '/category/opinion', 'Opinion'],
  ['Analysis', '/category/analysis', 'Analysis'], ['Interviews', '/category/interviews', 'Interviews'],
  ['Debate', '/opinion-debate', 'Opinion Debate'], ['About', '/about', 'About'],
]
async function arrived(page: Page, path: string, heading: string) {
  await expect(page).toHaveURL(new URL(path, page.url()).href)
  await expect(page.locator('main h1')).toHaveText(heading)
}
async function popup(page: Page, link: Locator, destination: string, touch = false) {
  const target = new URL(destination).href
  expect(new URL((await link.getAttribute('href'))!).href).toBe(target)
  // Capture only this external transport boundary; the provider receives no request.
  await page.context().route(url => url.href === target, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Controlled external destination</h1>' }))
  const opened = page.context().waitForEvent('page')
  const response = page.context().waitForEvent('response', { predicate: response => response.url() === target })
  if (touch) await link.tap()
  else await link.click()
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
      // The response precedes NextAuth's redirect and the protected profile's
      // signed-out redirect. Reopening the old drawer can be lost on navigation.
      await expect(page).toHaveURL(url => url.pathname === '/login')
      expect((await (await ctx.request.get('/api/auth/session')).json()).user).toBeUndefined()
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
    articles.push(await db().article.create({ data: { title, slug: slug(title), authorId: author.id, categoryId: categories[index === 2 ? 1 : 0].id, seriesId: series.id, seriesOrder: order, status: index === 3 ? 'DRAFT' : 'PUBLISHED', publishedAt: index === 3 ? null : new Date(), content: JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Repeated section' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'First section body.' }] }, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Repeated section' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second section body.' }] }] }), tags: { create: { tagId: tag.id } } } }))
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
  const tagCard = page.locator('main article').filter({ has: page.locator(`a[href="${middle}"]`) })
  await tagCard.getByRole('link', { name: categories[0].name, exact: true }).click()
  await arrived(page, `/category/${categories[0].slug}`, categories[0].name)
  await page.goBack({ waitUntil: 'networkidle' })
  await arrived(page, `/tag/${tag.slug}`, tag.name)
  await tagCard.getByRole('link', { name: author.name, exact: true }).click()
  await arrived(page, `/author/${authorSlug}`, author.name)
  await page.goBack({ waitUntil: 'networkidle' })
  await arrived(page, `/tag/${tag.slug}`, tag.name)
  await page.locator(`main article a[href="${middle}"]`).click()
  await arrived(page, middle, articles[1].title)
  await page.getByRole('link', { name: new RegExp(`Next.*${articles[2].title}`) }).click()
  await arrived(page, `/articles/${articles[2].slug}`, articles[2].title)
  await expect(headings.nth(1)).toHaveAttribute('id', 'repeated-section-2')
  await expect(headings.nth(1).getByRole('link')).toHaveAttribute('href', '#repeated-section-2')
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

test('cookie privacy/decline/accept and the third-visit signup prompt exercise every available action', async ({ browser }) => {
  test.setTimeout(120_000) // Fresh consent states and three prompt choices, including the specified 3.5s appearance delay.
  for (const action of ['Dismiss', 'Maybe Later', 'Create Account']) {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/', { waitUntil: 'networkidle' })
    const consent = page.getByRole('dialog', { name: 'Cookie consent', exact: true })
    if (action === 'Dismiss') {
      await consent.getByRole('link', { name: 'Privacy Policy', exact: true }).click()
      await arrived(page, '/privacy', 'Privacy Policy')
      await consent.getByRole('button', { name: 'Decline', exact: true }).click()
      await expect(consent).toBeHidden()
      await page.reload({ waitUntil: 'networkidle' })
      await expect(consent).toHaveCount(0)
      expect(await page.evaluate(() => localStorage.getItem('consilium_cookie_consent'))).toBe('declined')
      expect((await ctx.cookies()).some(c => c.name === 'consilium_visits')).toBe(false)
      await page.evaluate(() => localStorage.removeItem('consilium_cookie_consent'))
      await page.goto('/', { waitUntil: 'networkidle' })
    }
    await consent.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(consent).toBeHidden()
    await page.reload({ waitUntil: 'networkidle' }) // First consented page view.
    await expect(consent).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('consilium_cookie_consent'))).toBe('accepted')
    const mainNav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
    await mainNav.getByRole('link', { name: 'News', exact: true }).click()
    await arrived(page, '/category/news', 'News')
    await mainNav.getByRole('link', { name: 'About', exact: true }).click()
    await arrived(page, '/about', 'About')
    expect((await ctx.cookies()).find(c => c.name === 'consilium_visits')?.value).toBe('3')
    const prompt = page.getByRole('dialog', { name: 'Create an account', exact: true })
    await expect(prompt).toBeVisible()
    await prompt.getByRole(action === 'Create Account' ? 'link' : 'button', { name: action, exact: true }).click()
    await expect(prompt).toBeHidden()
    expect((await ctx.cookies()).find(c => c.name === 'consilium_prompt_dismissed')?.value).toMatch(/^\d+$/)
    if (action === 'Create Account') {
      await expect(page).toHaveURL(new URL('/signup', page.url()).href)
      await expect(page.locator('input[type=email]')).toBeVisible()
    } else {
      await page.reload({ waitUntil: 'networkidle' })
      await expect(prompt).toHaveCount(0)
    }
    await ctx.close()
  }
})

test('iOS and Android install guidance dismisses and stays dismissed after reopening', async ({ browser }) => {
  for (const [userAgent, instruction] of [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'Share'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', 'browser menu'],
  ]) {
    const ctx = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    const guidance = page.getByRole('banner').filter({ hasText: 'Install The Consilium' })
    await expect(guidance).toBeVisible()
    await expect(guidance).toContainText(instruction)
    await guidance.getByRole('button', { name: 'Dismiss install banner', exact: true }).click()
    await expect(guidance).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('consilium_install_dismissed'))).toBe('1')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(guidance).toHaveCount(0)
    await ctx.close()
  }
})

test('public team cards trap and restore focus, close by button/backdrop/Escape, and activate author/email links', async ({ browser }) => {
  test.setTimeout(60_000)
  const owner = await createAccount('WRITER', 'team-dialog')
  const account = await db().user.findUniqueOrThrow({ where: { id: owner.id } })
  await db().teamMember.create({ data: { userId: owner.id, name: owner.name, email: owner.email, role: 'Writer', bio: 'A complete controlled team biography.', isActive: true } })
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/team', { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const card = page.getByRole('button', { name: `View full profile for ${owner.name}`, exact: true })
  const dialog = page.getByRole('dialog', { name: owner.name, exact: true })
  for (const action of ['Escape', 'button', 'backdrop']) {
    await card.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('A complete controlled team biography.')
    expect(await page.locator('body').evaluate(el => el.style.overflow)).toBe('hidden')
    if (action === 'Escape') {
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: `Close profile for ${owner.name}` })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('link', { name: owner.email, exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: `Close profile for ${owner.name}` })).toBeFocused()
      await page.keyboard.press('Escape')
    } else if (action === 'button') await dialog.getByRole('button', { name: `Close profile for ${owner.name}` }).click()
    else {
      const bannerBottom = await page.getByRole('region', { name: 'Testing environment' }).evaluate(el => el.getBoundingClientRect().bottom)
      await page.mouse.click(10, bannerBottom + 10)
    }
    await expect(dialog).toBeHidden()
    await expect(card).toBeFocused()
    expect(await page.locator('body').evaluate(el => el.style.overflow)).toBe('')
  }
  await card.click()
  await page.evaluate(() => document.addEventListener('click', event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="mailto:"]')
    if (link) { event.preventDefault(); document.documentElement.dataset.mailto = link.href }
  }, true))
  await dialog.getByRole('link', { name: owner.email, exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-mailto', `mailto:${owner.email}`)
  await dialog.getByRole('link', { name: 'Read their articles →', exact: true }).click()
  await arrived(page, `/author/${account.slug}`, owner.name)
  await ctx.close()
})

test('reading-position jump/dismiss and home continuation reopen server-saved progress through actual controls', async ({ browser }) => {
  test.setTimeout(60_000)
  const owner = await createAccount('READER', 'reading-controls')
  const writer = await createAccount('WRITER', 'reading-author')
  const title = uniqueTitle('Reading controls')
  const article = await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(), content: paragraphs('A long representative article paragraph for restoring a real reading position.', 80) } })
  const nextTitle = uniqueTitle('Reading continuation destination')
  const nextArticle = await db().article.create({ data: { title: nextTitle, slug: nextTitle.toLowerCase().replaceAll(' ', '-'), authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(), content: paragraphs('A second article without any saved position.', 80) } })
  await db().readingProgress.create({ data: { userId: owner.id, articleId: article.id, progress: 40, scrollY: 600 } })
  const reader = await signInAs(browser, owner)
  const page = await reader.newPage()
  await page.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
  await new ArticleEditorPage(page).dismissCookieBanner()
  const banner = page.getByText('Continue where you left off', { exact: true }).locator('..').locator('..')
  await expect(banner).toBeVisible()
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reading-progress' && r.request().method() === 'POST' && r.request().postDataJSON()?.scrollY === 600)
  await banner.getByRole('button', { name: 'Jump back', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
  expect((await saved).status()).toBe(200)
  await expect(banner).toBeHidden()
  expect((await db().readingProgress.findUniqueOrThrow({ where: { userId_articleId: { userId: owner.id, articleId: article.id } } })).scrollY).toBe(600)
  const fresh = await reader.newPage()
  await fresh.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
  const freshBanner = fresh.getByText('Continue where you left off', { exact: true }).locator('..').locator('..')
  await freshBanner.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(freshBanner).toBeHidden()
  await fresh.getByRole('link', { name: '← Back to Homepage', exact: true }).click()
  await expect(fresh.getByText('Continue Reading', { exact: true }).first()).toBeVisible()
  // The continuation row is distinct from the homepage's article cards.
  const row = fresh.locator('a').filter({ has: fresh.locator('p', { hasText: title }) }).filter({ hasText: '%' })
  await row.click()
  await arrived(fresh, `/articles/${article.slug}`, title)
  await expect(fresh.getByText('Continue where you left off', { exact: true })).toBeVisible()
  // Reaching the homepage link legitimately scrolled the first article further.
  // Compare the latest saved record at this boundary, not its initial fixture.
  const priorPosition = await db().readingProgress.findUniqueOrThrow({ where: { userId_articleId: { userId: owner.id, articleId: article.id } } })
  // Scrolling to the destination link is itself reading: the first article's page may legitimately save a
  // further position (at most one per 4s) as the click begins. Track what it actually saved, so the stored
  // value can be compared exactly with the last accepted write instead of a snapshot that can go stale.
  const acceptedWrites: number[] = []
  fresh.on('response', response => {
    const request = response.request()
    if (new URL(response.url()).pathname !== '/api/reading-progress' || request.method() !== 'POST' || response.status() !== 200) return
    const body = request.postDataJSON()
    if (body?.articleId === article.id) acceptedWrites.push(body.scrollY)
  })
  const emptyPosition = fresh.waitForResponse(r => new URL(r.url()).pathname === `/api/reading-progress/${nextArticle.id}`)
  await fresh.getByRole('link', { name: nextTitle, exact: true }).click()
  await arrived(fresh, `/articles/${nextArticle.slug}`, nextTitle)
  const response = await emptyPosition
  expect(response.status()).toBe(200)
  expect(await response.json()).toBeNull()
  await expect(fresh.getByText('Continue where you left off', { exact: true })).toHaveCount(0)
  await fresh.waitForLoadState('networkidle') // any save begun by the old page has been answered
  expect((await db().readingProgress.findUniqueOrThrow({ where: { userId_articleId: { userId: owner.id, articleId: article.id } } })).scrollY).toBe(acceptedWrites.at(-1) ?? priorPosition.scrollY)
  expect(await db().readingProgress.findUnique({ where: { userId_articleId: { userId: owner.id, articleId: nextArticle.id } } })).toBeNull()
  await reader.close()
})

test('guest reading-position nudge close/later/signup and homepage invitation activate', async ({ browser }) => {
  test.setTimeout(90_000)
  const writer = await createAccount('WRITER', 'guest-reading-author')
  const title = uniqueTitle('Guest reading controls')
  const article = await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(), content: paragraphs('A long guest article paragraph for restoring a reading position.', 80) } })
  for (const action of ['Dismiss', 'Maybe Later', 'Create Account', 'home']) {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/', { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    await page.evaluate(({ id }) => localStorage.setItem(`consilium_rp_${id}`, JSON.stringify({ progress: 40, scrollY: 600 })), { id: article.id })
    if (action === 'home') {
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.getByText('You have 1 article in progress', { exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'Create a free account', exact: true }).click()
    } else {
      await page.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
      const nudge = page.getByText('Reading progress saved', { exact: true }).locator('..')
      await expect(nudge).toBeVisible()
      await nudge.getByRole(action === 'Create Account' ? 'link' : 'button', { name: action, exact: true }).click()
      await expect(nudge).toBeHidden()
    }
    if (action === 'home' || action === 'Create Account') {
      await expect(page).toHaveURL(new URL('/signup', page.url()).href)
      await expect(page.locator('input[type=email]')).toBeVisible()
    } else {
      expect(await page.evaluate(() => sessionStorage.getItem('consilium_nudge_seen'))).toBe('1')
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.getByText('Reading progress saved', { exact: true })).toHaveCount(0)
    }
    await ctx.close()
  }
})

test('persistent reading-position sync failure is visible and a successful retry saves the real scroll position', async ({ browser }) => {
  test.setTimeout(60_000) // Actual scrolls trigger two four-second application debounces, not test sleeps.
  const reader = await createAccount('READER', 'reading-retry')
  const writer = await createAccount('WRITER', 'reading-retry-author')
  const title = uniqueTitle('Reading retry')
  const article = await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: writer.id, status: 'PUBLISHED', publishedAt: new Date(), content: paragraphs('A representative reading retry paragraph long enough to provide real scrolling.', 80) } })
  const ctx = await signInAs(browser, reader)
  const page = await ctx.newPage()
  await page.route('**/api/reading-progress**', r => r.fulfill({ status: 503, json: { error: 'Reading sync unavailable' } }))
  const failedLoad = page.waitForResponse(r => new URL(r.url()).pathname === `/api/reading-progress/${article.id}`)
  await page.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
  expect((await failedLoad).status()).toBe(503)
  await new ArticleEditorPage(page).dismissCookieBanner()
  const notice = page.getByRole('status').filter({ hasText: 'Your reading position isn’t saving right now.' })
  for (let i = 0; i < 2; i++) {
    const failure = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reading-progress' && r.request().method() === 'POST')
    await page.mouse.wheel(0, 300)
    expect((await failure).status()).toBe(503)
  }
  await expect(notice).toBeVisible()
  await page.unroute('**/api/reading-progress**')
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reading-progress' && r.request().method() === 'POST')
  await page.mouse.wheel(0, 300)
  const response = await saved
  expect(response.status()).toBe(200)
  const sent = response.request().postDataJSON()
  expect(sent.scrollY).toBeGreaterThan(0)
  const persisted = await db().readingProgress.findUniqueOrThrow({ where: { userId_articleId: { userId: reader.id, articleId: article.id } } })
  expect(persisted.scrollY).toBe(sent.scrollY)
  expect(persisted.progress).toBe(sent.progress)
  await expect(notice).toHaveCount(0)
  const fresh = await ctx.newPage()
  await fresh.goto(`/articles/${article.slug}`, { waitUntil: 'networkidle' })
  await expect(fresh.getByText('Continue where you left off', { exact: true })).toBeVisible()
  await ctx.close()
})

test('public glossary hover, keyboard, touch, learn-more and client article transitions bind to the current content', async ({ browser }) => {
  test.setTimeout(90_000)
  const admin = await signedIn(browser, 'admin')
  const oldEnabled = (await db().siteSetting.findUnique({ where: { key: 'glossary_linking_enabled' } }))?.value === 'true'
  const term = uniqueTitle('tooltip')
  const definition = 'A controlled definition for the public glossary interaction.'
  const destination = 'https://example.org/controlled-glossary'
  const created = await admin.request.post('/api/editorial/glossary', { data: { term, definition, aliases: [], learnMoreUrl: destination } })
  expect(created.status()).toBe(200)
  ownedTerms.push((await created.json()).id)
  if (!oldEnabled) expect((await admin.request.patch('/api/editorial/glossary/settings', { data: { enabled: true } })).status()).toBe(200)
  try {
    const writer = await createAccount('WRITER', 'glossary-controls')
    const prefix = uniqueTitle('Public glossary')
    const articles = []
    for (let i = 0; i < 2; i++) articles.push(await db().article.create({ data: { title: `${prefix} ${i}`, slug: `${prefix}-${i}`.toLowerCase().replaceAll(' ', '-'), authorId: writer.id, content: paragraphs(`This paragraph explains ${term} for the reader.`), status: 'PUBLISHED', publishedAt: new Date() } }))
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`/articles/${articles[0].slug}`, { waitUntil: 'networkidle' })
    await new ArticleEditorPage(page).dismissCookieBanner()
    const trigger = page.getByRole('button', { name: term, exact: true })
    const tip = page.getByRole('tooltip').filter({ hasText: definition })
    await trigger.hover()
    await expect(tip).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(trigger).toHaveAttribute('aria-describedby', 'glossary-tooltip')
    await popup(page, tip.getByRole('link', { name: 'Learn more', exact: true }), destination)
    await trigger.press('Escape')
    await expect(tip).toBeHidden()
    await trigger.press('Enter')
    await expect(tip).toBeVisible()
    await trigger.press('Space')
    await expect(tip).toBeHidden()
    await trigger.press('Enter')
    await page.locator('main h1').click()
    await expect(tip).toBeHidden()
    await page.getByRole('link', { name: articles[1].title, exact: true }).click()
    await arrived(page, `/articles/${articles[1].slug}`, articles[1].title)
    await trigger.hover()
    await expect(tip).toBeVisible()
    await ctx.close()
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const phone = await mobile.newPage()
    await phone.goto(`/articles/${articles[0].slug}`, { waitUntil: 'networkidle' })
    await new ArticleEditorPage(phone).dismissCookieBanner()
    const tapped = phone.getByRole('button', { name: term, exact: true })
    const mobileTip = phone.getByRole('tooltip').filter({ hasText: definition })
    await tapped.tap()
    await expect(mobileTip).toBeVisible()
    const box = (await mobileTip.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(8)
    expect(box.x + box.width).toBeLessThanOrEqual(382)
    await tapped.tap()
    await expect(mobileTip).toBeHidden()
    await tapped.tap()
    await phone.locator('main h1').tap()
    await expect(mobileTip).toBeHidden()
    await tapped.tap()
    await popup(phone, mobileTip.getByRole('link', { name: 'Learn more', exact: true }), destination, true)
    await mobile.close()
  } finally {
    if (!oldEnabled) expect((await admin.request.patch('/api/editorial/glossary/settings', { data: { enabled: false } })).status()).toBe(200)
    await admin.close()
  }
})

test('a root chrome exception exposes the real global boundary and its retry/home controls restore the application', async ({ browser }, testInfo) => {
  test.setTimeout(60_000)
  for (const action of ['Try again', '← Back to Homepage']) {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    // Fault injection is limited to this context and one client read, never the server/database.
    await ctx.addInitScript(() => {
      const get = Storage.prototype.getItem
      Storage.prototype.getItem = function(key) {
        if (key === 'consilium_cookie_consent' && sessionStorage.getItem('consilium-e2e-root-fault-fired') !== '1') {
          sessionStorage.setItem('consilium-e2e-root-fault-fired', '1')
          throw new Error('Controlled root chrome access failure')
        }
        return get.call(this, key)
      }
    })
    const page = await ctx.newPage()
    const errors = collectConsoleErrors(page)
    expect((await page.goto('/', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await expect(page.locator('header')).toHaveCount(0)
    expect(errors.length).toBeGreaterThan(0)
    // Assert every diagnostic belongs to the injected exception; retain them as evidence.
    for (const error of errors) expect(error).toContain('Controlled root chrome access failure')
    const count = errors.length
    await testInfo.attach(`root-error-${action === 'Try again' ? 'retry' : 'home'}`, { body: JSON.stringify(errors), contentType: 'application/json' })
    const recovered = page.waitForResponse(response => new URL(response.url()).pathname === '/' && response.request().method() === 'GET')
    await page.getByRole(action === 'Try again' ? 'button' : 'link', { name: action, exact: true }).click()
    expect((await recovered).status()).toBe(200)
    await arrived(page, '/', 'The Consilium')
    await new ArticleEditorPage(page).dismissCookieBanner()
    await page.waitForLoadState('networkidle')
    expect(errors).toHaveLength(count)
    await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'News', exact: true }).click()
    await arrived(page, '/category/news', 'News')
    await ctx.close()
  }
})

test('a disposable database outage exposes the page boundary; retry/home recover without losing trashed content', async ({ browser }, testInfo) => {
  test.setTimeout(90_000)
  // This deliberately interrupts one owned service. Full and critical workflow phases
  // run with one worker; refuse this scenario before touching fixtures in a parallel run.
  expect(testInfo.config.workers, 'service outage coverage requires --workers=1').toBe(1)
  const owner = await createAccount('WRITER', 'trash-outage')
  const title = uniqueTitle('Trash service recovery')
  const article = await db().article.create({ data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), authorId: owner.id, content: 'Content retained through a real disposable database outage.', status: 'DRAFT', deletedAt: new Date() } })
  const ctx = await signInAs(browser, owner)
  try {
    for (const action of ['Try again', '← Back to Homepage']) {
      const page = await ctx.newPage()
      const errors = collectConsoleErrors(page)
      // db() verifies the run-owned database. No credentials or production schema is used.
      await db().$executeRaw`ALTER TABLE "articles" RENAME TO "consilium_e2e_outage_articles"`
      let failureStatus: number | undefined
      try {
        failureStatus = (await page.goto('/editorial/trash', { waitUntil: 'networkidle' }))?.status()
        await expect(page.getByRole('heading', { name: 'Unexpected Error', exact: true })).toBeVisible()
        await expect(page.getByText('Trash is empty.', { exact: true })).toHaveCount(0)
      } finally {
        // Restore even if navigation/assertions fail, before another scenario can run.
        await db().$executeRaw`ALTER TABLE "consilium_e2e_outage_articles" RENAME TO "articles"`
      }
      await testInfo.attach(`database-outage-${action === 'Try again' ? 'retry' : 'home'}`, { body: JSON.stringify({ failureStatus, errors }), contentType: 'application/json' })
      const beforeRecovery = errors.length
      const destination = action === 'Try again' ? '/editorial/trash' : '/'
      const recovered = page.waitForResponse(r => new URL(r.url()).pathname === destination && r.request().method() === 'GET')
      await page.getByRole(action === 'Try again' ? 'button' : 'link', { name: action, exact: true }).click()
      expect((await recovered).status()).toBe(200)
      if (action === 'Try again') {
        await expect(page.getByRole('heading', { name: 'Trash', exact: true })).toBeVisible()
        await expect(page.getByText(title, { exact: true })).toBeVisible()
      } else await arrived(page, '/', 'The Consilium')
      await page.waitForLoadState('networkidle')
      expect(errors).toHaveLength(beforeRecovery)
      const persisted = await db().article.findUniqueOrThrow({ where: { id: article.id } })
      expect(persisted.content).toBe(article.content)
      expect(persisted.status).toBe('DRAFT')
      expect(persisted.deletedAt).not.toBeNull()
      expect((await ctx.request.get(`/articles/${article.slug}`)).status()).toBe(404)
      await page.close()
    }
  } finally { await ctx.close() }
})
