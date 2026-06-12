import { test, expect, type Page } from '@playwright/test'
import { collectConsoleErrors } from './helpers/console'
import { upsertFootnoteTestArticle, closeDb } from './helpers/db'

/**
 * Footnote popover behaviour on the public article page. The fixture article
 * stores stale, duplicated, out-of-order footnote indices (5, 2, 2); the
 * renderer renumbers them 1..3 in document order, so these tests double as a
 * live check of the numbering fix. One footnote contains an attempted script
 * tag, which must surface as inert literal text everywhere.
 *
 * The markers are deliberately tiny inline <sup> elements with a super
 * baseline. Playwright's locator actionability mis-rates such targets (it
 * reports "outside of the viewport" / "not visible" even when they render and
 * hit-test fine), so hover/click/tap are driven as real mouse and touch events
 * at the element's measured centre via the point() helper below. State is still
 * asserted through ordinary locators. The site also uses scroll-behavior:
 * smooth, which deadlocks Playwright's auto-scroll; prep() forces it to auto for
 * the duration of the test.
 */

let slug = 'footnote-popover-test'

test.beforeAll(async () => {
  slug = await upsertFootnoteTestArticle()
})

test.afterAll(async () => {
  await closeDb()
})

const POPOVER = '#footnote-popover'

async function prep(page: Page) {
  await page.goto(`/articles/${slug}`, { waitUntil: 'networkidle' })
  // Dismiss the cookie banner: it is fixed to the bottom of the viewport and
  // would obscure markers scrolled near the page bottom.
  const accept = page.getByRole('button', { name: /^accept$/i })
  if (await accept.count()) await accept.first().click()
  // Smooth scrolling fights Playwright; make programmatic scrolling instant.
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' })
  // Let the entrance animation settle so positions are stable.
  await expect(page.locator('#fnref-1')).toBeVisible()
  await page.waitForTimeout(900)
}

/** Centre a marker (or its inner link) and return its viewport centre point. */
function point(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    el.scrollIntoView({ block: 'center' })
    const target = el.querySelector('a') ?? el
    const r = target.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
}

test.describe('desktop', () => {
  test('markers are renumbered sequentially and the list matches', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await prep(page)
    await expect(page.locator('sup.footnote-ref')).toHaveCount(3)
    for (const n of [1, 2, 3]) {
      await expect(page.locator(`#fnref-${n} a`)).toHaveText(`[${n}]`)
      await expect(page.locator(`#fn-${n}`)).toHaveCount(1)
    }
    // No stale stored index leaks through, and no native title tooltip remains
    await expect(page.locator('sup.footnote-ref[data-index="5"]')).toHaveCount(0)
    await expect(page.locator('sup.footnote-ref[title]')).toHaveCount(0)
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('hover shows the popover with decoded text and no layout shift', async ({ page }) => {
    await prep(page)
    const p = await point(page, '#fnref-2')
    const before = await page.evaluate(() => ({
      h: document.body.scrollHeight,
      box: document.getElementById('fnref-2')!.getBoundingClientRect().toJSON(),
    }))

    await page.mouse.move(p.x, p.y)
    await expect(page.locator(POPOVER)).toBeVisible()
    // The attempted script tag is literal text, decoded from the data attribute
    await expect(page.locator(POPOVER)).toContainText('watch the <script>alert(1)</script> & §catering» component')
    await expect(page.locator(`${POPOVER} .footnote-popover-label`)).toHaveText('Footnote 2')
    await expect(page.locator(POPOVER)).toHaveAttribute('role', 'tooltip')

    // Opening the popover must not move the page or the marker
    const after = await page.evaluate(() => ({
      h: document.body.scrollHeight,
      box: document.getElementById('fnref-2')!.getBoundingClientRect().toJSON(),
    }))
    expect(after.h).toBe(before.h)
    expect(after.box).toEqual(before.box)

    // Moving the pointer away hides it (after the grace period)
    await page.mouse.move(5, 5)
    await expect(page.locator(POPOVER)).toBeHidden()
  })

  test('keyboard: Tab focus shows it, Escape dismisses, focus stays put', async ({ page }) => {
    await prep(page)
    // Park focus on a probe button immediately before the first marker, then Tab
    // so the marker link gains focus from a real keyboard interaction
    // (:focus-visible applies, which is what gates the focus popover).
    await page.evaluate(() => {
      const sup = document.getElementById('fnref-1')!
      sup.scrollIntoView({ block: 'center' })
      const probe = document.createElement('button')
      probe.id = 'focus-probe'
      sup.parentElement!.insertBefore(probe, sup)
      probe.focus()
    })
    await page.keyboard.press('Tab')

    const link = page.locator('#fnref-1 a')
    await expect(link).toBeFocused()
    await expect(page.locator(POPOVER)).toBeVisible()
    await expect(link).toHaveAttribute('aria-describedby', 'footnote-popover')

    await page.keyboard.press('Escape')
    await expect(page.locator(POPOVER)).toBeHidden()
    // Focus is not trapped or moved by dismissal
    await expect(link).toBeFocused()
  })

  test('marker click jumps to the list entry; back-link returns to the marker', async ({ page }) => {
    await prep(page)
    const p = await point(page, '#fnref-3')
    await page.mouse.click(p.x, p.y)

    const entry = page.locator('#fn-3')
    await expect(entry).toBeInViewport()
    await expect(entry).toHaveClass(/footnote-flash/)
    // The URL in the footnote text is plain text in the list
    await expect(entry).toContainText('https://www.ons.gov.uk/economy/inflationandpriceindices?edition=2026&format=csv#downloads')
    expect(new URL(page.url()).hash).toBe('#fn-3')

    const bp = await point(page, '#fn-3 a.footnote-backlink')
    await page.mouse.click(bp.x, bp.y)
    await expect(page.locator('#fnref-3')).toBeInViewport()
    await expect(page.locator('#fnref-3 a')).toBeFocused()
    expect(new URL(page.url()).hash).toBe('#fnref-3')
  })

  test('dark mode popover uses dark surfaces', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await prep(page)
    await expect(page.locator('html')).toHaveClass(/dark/)
    const p = await point(page, '#fnref-1')
    await page.mouse.move(p.x, p.y)
    await expect(page.locator(POPOVER)).toBeVisible()
    const bg = await page.locator(POPOVER).evaluate((el) => getComputedStyle(el).backgroundColor)
    // Any dark-theme surface: assert it is not the light card white
    expect(bg).not.toBe('rgb(255, 255, 255)')
  })
})

test.describe('mobile touch', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true })

  test('tap shows the popover inside the viewport; tapping elsewhere dismisses', async ({ page }) => {
    await prep(page)
    const p = await point(page, '#fnref-2')
    await page.touchscreen.tap(p.x, p.y)
    await expect(page.locator(POPOVER)).toBeVisible()

    const box = (await page.locator(POPOVER).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(812)

    // A tap on a marker must not navigate-jump the page like a plain anchor
    expect(new URL(page.url()).hash).toBe('')

    await page.touchscreen.tap(20, 400)
    await expect(page.locator(POPOVER)).toBeHidden()
  })

  test('tapping the same marker again toggles the popover closed', async ({ page }) => {
    await prep(page)
    const p = await point(page, '#fnref-1')
    await page.touchscreen.tap(p.x, p.y)
    await expect(page.locator(POPOVER)).toBeVisible()
    await page.touchscreen.tap(p.x, p.y)
    await expect(page.locator(POPOVER)).toBeHidden()
  })
})
