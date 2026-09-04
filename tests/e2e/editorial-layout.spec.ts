import { test, expect } from '@playwright/test'

/**
 * Layout invariants for the editorial portal shell.
 *
 * The portal is a bounded app shell: it fills the viewport, the sidebar stays
 * put, and only the content region scrolls. Three regressions this guards
 * against, all of which were live before:
 *
 *   1. The public marketing Footer rendered inside the portal, adding ~690px of
 *      dead height below every dashboard page and pushing the sidebar out of
 *      view once the document scrolled.
 *   2. The document itself scrolled, so the sidebar (and Sign Out) scrolled
 *      away on any page taller than the viewport.
 *   3. The portal rendered a second <main> inside the root layout's <main>.
 *
 * Horizontal overflow is asserted everywhere: the portal must never produce a
 * browser-level sideways scrollbar at any supported width.
 */

const ROUTES = [
  '/editorial',
  '/editorial/articles',
  '/editorial/calendar',
  '/editorial/glossary',
  '/editorial/users',
  '/editorial/review',
  '/editorial/comments',
  '/editorial/trash',
  '/editorial/analytics',
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 900, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]

async function metrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const de = document.documentElement
    return {
      documentScrolls: de.scrollHeight > de.clientHeight + 1,
      horizontalOverflow: de.scrollWidth - de.clientWidth,
      mainCount: document.querySelectorAll('main').length,
      hasFooter: !!document.querySelector('footer'),
    }
  })
}

for (const vp of VIEWPORTS) {
  test(`portal shell stays bounded with no horizontal overflow (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' })
      const m = await metrics(page)

      expect(m.hasFooter, `${route} must not render the public footer`).toBe(false)
      expect(m.documentScrolls, `${route} document must not scroll`).toBe(false)
      expect(
        m.horizontalOverflow,
        `${route} must not overflow horizontally`
      ).toBeLessThanOrEqual(0)
      expect(m.mainCount, `${route} must have exactly one <main>`).toBe(1)
    }
  })
}

test('sidebar and sign out stay in view while the content region scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // A page whose content is taller than the shell, so there is something to scroll.
  await page.goto('/editorial/users', { waitUntil: 'networkidle' })

  const region = page.locator('aside').locator('..').locator('+ div')
  await expect(region).toHaveCount(1)

  const before = await page.locator('aside').boundingBox()
  await region.evaluate((el) => el.scrollBy(0, 600))
  await page.waitForTimeout(300)
  const after = await page.locator('aside').boundingBox()

  // The sidebar has not moved, and the document still has not scrolled.
  expect(after?.y).toBe(before?.y)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // Sign Out is still reachable without scrolling the page.
  await expect(page.getByRole('button', { name: /sign out/i })).toBeInViewport()
})
