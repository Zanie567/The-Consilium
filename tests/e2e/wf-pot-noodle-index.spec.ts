import { test, expect, type Page } from '@playwright/test'
import { collectConsoleErrors } from './helpers/console'
import { signedIn } from './helpers/workflow'

/**
 * The Pot Noodle Index page (/pot-noodle-index): reachable from the navigation on desktop and phone,
 * listed in the sitemap, fits every width in both themes, and, until the editors supply the form and
 * results, shows no form link, no iframe and no numbers.
 */

async function open(page: Page, path = '/pot-noodle-index') {
  await page.addInitScript(() => { try { localStorage.setItem('consilium_cookie_consent', 'declined') } catch {} })
  const response = await page.goto(path, { waitUntil: 'networkidle' })
  expect(response?.status()).toBe(200)
  return response!
}

test('the Pot Noodle Index has its own entry in the desktop navigation', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/')
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  await expect(nav.getByRole('button', { name: 'Projects' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Pot Noodle Index', exact: true }).click()
  await page.waitForURL('**/pot-noodle-index')
  await expect(page.getByRole('heading', { level: 1, name: 'The Pot Noodle Index' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Pot Noodle Index', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(errors, errors.join('\n')).toEqual([])
})

test('a signed-out visitor sees every section inline from 1260px, without crowding', async ({ page }) => {
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 })
    await open(page, '/')
    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
    await expect(nav).toBeVisible()
    expect(await page.locator('header > div').evaluate((el) => el.scrollWidth <= el.clientWidth), `${width}px`).toBe(true)
  }
})

const RESPONDER = 'https://docs.google.com/forms/d/e/1FAIpQLSeS11HO0EzhS-MkarU7FJHeRxfiC6_2gLDahBYkUBM9wHmSAA/viewform'

test('the page links the form, loads it only when asked, and shows no figures yet', async ({ page }) => {
  // Google is never contacted from the test: the embed is answered locally.
  await page.context().route('https://docs.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stub form</title><p>Stub form</p>' }))
  const googleRequests: string[] = []
  page.on('request', (r) => { if (r.url().includes('docs.google.com')) googleRequests.push(r.url()) })
  await open(page)
  await expect(page.getByText('Collecting prices now')).toBeVisible()
  expect(await page.locator('.pni-page').innerText()).not.toMatch(/£\s?\d/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/pot-noodle-index$/)
  const direct = page.locator('.pni-page').getByRole('link', { name: /Open in Google Forms/ })
  await expect(direct).toHaveAttribute('href', RESPONDER)
  await expect(direct).toHaveAttribute('target', '_blank')
  // Declined cookies: nothing from Google until the reader asks for the form.
  await page.locator('#take-part').scrollIntoViewIfNeeded()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(googleRequests).toEqual([])
  await page.getByRole('button', { name: 'Load the form here' }).click()
  const frame = page.locator('iframe[title="The Pot Noodle Index submission form (Google Forms)"]')
  await expect(frame).toHaveAttribute('src', `${RESPONDER}?embedded=true`)
  await expect(frame).toHaveAttribute('sandbox', /allow-forms/)
  await expect(page.frameLocator('iframe').getByText('Stub form')).toBeVisible()
})

test('"Add your prices" goes to the form and loads it', async ({ page }) => {
  await page.context().route('https://docs.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Stub form</p>' }))
  await open(page)
  await page.getByRole('link', { name: 'Add your prices' }).click()
  await expect(page).toHaveURL(/#take-part$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Add your prices' })).toBeInViewport()
  await expect(page.locator('iframe')).toHaveCount(1)
})

test('the sitemap lists the page', async ({ request }) => {
  const body = await (await request.get('/sitemap.xml')).text()
  expect(body).toContain('/pot-noodle-index</loc>')
})

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`${width}px ${theme}: no sideways scrolling, every section present`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
      await open(page)
      for (const name of ['A cost-of-living index for students', 'Add your prices', 'The index', 'Method and updates']) {
        await expect(page.getByRole('heading', { level: 2, name })).toBeAttached()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (width === 375) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click()
        const menu = page.getByRole('navigation', { name: 'Mobile navigation' })
        await expect(menu.getByRole('link', { name: 'Pot Noodle Index', exact: true })).toHaveAttribute('aria-current', 'page')
        await expect(menu.getByRole('link', { name: 'Trading', exact: true })).toBeVisible()
      }
      await ctx.close()
    })
  }
}

test('signed in, the bar goes inline only where the account controls fit (1360px)', async ({ browser }) => {
  const ctx = await signedIn(browser, 'editor')
  const page = await ctx.newPage()
  await page.addInitScript(() => { try { localStorage.setItem('consilium_cookie_consent', 'declined') } catch {} })
  for (const [width, inline] of [[1300, false], [1366, true], [1440, true], [1720, true]] as const) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/pot-noodle-index', { waitUntil: 'networkidle' })
    await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true }), `${width}px`).toBeVisible({ visible: inline })
    await expect(page.getByRole('button', { name: 'Open menu', exact: true }), `${width}px`).toBeVisible({ visible: !inline })
    expect(await page.locator('header > div').evaluate((el) => el.scrollWidth <= el.clientWidth), `${width}px`).toBe(true)
  }
  await ctx.close()
})
