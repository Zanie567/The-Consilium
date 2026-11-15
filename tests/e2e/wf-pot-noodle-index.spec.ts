import { test, expect, type Page } from '@playwright/test'
import { collectConsoleErrors } from './helpers/console'

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

test('Projects in the desktop navigation leads to the Pot Noodle Index', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/')
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  await nav.getByRole('button', { name: 'Projects', exact: true }).click()
  await nav.getByRole('link', { name: /^Pot Noodle Index/ }).click()
  await page.waitForURL('**/pot-noodle-index')
  await expect(page.getByRole('heading', { level: 1, name: 'The Pot Noodle Index' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute('data-active', '')
  expect(errors, errors.join('\n')).toEqual([])
})

test('the page says it is collecting, with no form link, no embed and no figures until they are supplied', async ({ page }) => {
  await open(page)
  // The page's own content (the site footer carries the general feedback form link).
  const html = await page.locator('.pni-page').innerHTML()
  await expect(page.getByText('Collecting prices now')).toBeVisible()
  await expect(page.getByText('The form opens here soon')).toBeAttached()
  expect(html).not.toMatch(/docs\.google\.com\/forms|forms\.gle/)
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(await page.locator('.pni-page').innerText()).not.toMatch(/£\s?\d/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/pot-noodle-index$/)
  // Hero links reach their sections.
  await page.getByRole('link', { name: 'Add a price' }).click()
  await expect(page).toHaveURL(/#take-part$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Add a price' })).toBeInViewport()
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
      for (const name of ['A price index in a pot', 'Add a price', 'The index', 'Method and updates']) {
        await expect(page.getByRole('heading', { level: 2, name })).toBeAttached()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (width === 375) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click()
        const menu = page.getByRole('navigation', { name: 'Mobile navigation' })
        await expect(menu.getByRole('link', { name: 'Pot Noodle Index', exact: true })).toHaveAttribute('aria-current', 'page')
        await expect(menu.getByRole('link', { name: 'Trading Challenge', exact: true })).toBeVisible()
      }
      await ctx.close()
    })
  }
}
