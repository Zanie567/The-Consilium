import { test, expect, devices, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'

/**
 * The homepage economic ticker moves on phones as well as desktops.
 *
 * The ticker's two API routes are mocked with fixed, fresh readings (sometimes delayed, as a slow
 * network would), so nothing depends on a live market provider. Movement is measured, not inferred
 * from CSS: the track's on-screen position must change over time.
 *
 * Runs in the wf-chromium and wf-webkit projects; phone tests emulate the device in their own
 * context and run only in the matching engine (iPhone → WebKit, Pixel → Chromium).
 */
const QUOTES = [
  { label: 'FTSE 100', kind: 'index', value: 8123.4, changePercent: 0.37 },
  { label: 'S&P 500', kind: 'index', value: 5604.2, changePercent: -0.42 },
  { label: 'GBP/USD', kind: 'fx', value: 1.27121, changePercent: 0.1 },
]
const OBSERVATION = { label: 'FEDERAL RESERVE', value: 4.33, previousValue: 4.33, unit: '%' }
const EXPECTED_ITEMS = ['FTSE 100  8,123', 'S&P 500  5,604', 'GBP/USD  1.2712', 'FEDERAL RESERVE  4.33%']

const phone = (name: 'iPhone 14' | 'Pixel 7'): BrowserContextOptions => {
  const { defaultBrowserType: _engine, ...options } = devices[name]
  void _engine
  return options
}
const IPHONE = { device: phone('iPhone 14'), engine: 'webkit' }
const PIXEL = { device: phone('Pixel 7'), engine: 'chromium' }

const ticker = (page: Page) => page.getByRole('marquee', { name: 'Economic data ticker' })
/** The track's on-screen x, or null while it is not rendered (or the page is still navigating). */
const trackX = (page: Page) =>
  page.evaluate(() => (document.querySelector('[role="marquee"] div[style*="consilium-ticker"]') as HTMLElement | null)?.getBoundingClientRect().x ?? null)
    .catch(() => null)

async function openHome(browser: Browser, options: BrowserContextOptions, dataDelayMs = 0) {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference', ...options })
  const now = new Date()
  const asOf = now.toISOString()
  const observationDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const delayed = (json: unknown) => async (route: import('@playwright/test').Route) => {
    if (dataDelayMs) await new Promise((resolve) => setTimeout(resolve, dataDelayMs))
    await route.fulfill({ json })
  }
  await ctx.route('**/api/ticker/markets', delayed({ quotes: QUOTES.map((quote) => ({ ...quote, asOf })) }))
  await ctx.route('**/api/ticker/macro', delayed({ observations: [{ ...OBSERVATION, observationDate }] }))
  const page = await ctx.newPage()
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return { ctx, page }
}

/** Resolves once the track has travelled at least `px` to the left of where it is now. */
async function expectMoving(page: Page, px = 8) {
  let start: number | null = null
  await expect.poll(async () => {
    const x = await trackX(page)
    if (x === null) return 0
    start ??= x
    return start - x
  }, { message: 'ticker moves left', timeout: 10_000 }).toBeGreaterThan(px)
}

/** Only the mocked readings, in order, each exactly once per copy. */
async function expectOnlyApiData(page: Page) {
  const items = ticker(page).locator('.whitespace-nowrap')
  await expect(items).toHaveCount(EXPECTED_ITEMS.length * 2)
  const shown = await items.evaluateAll((els) => els.slice(0, els.length / 2).map((el) => el.textContent ?? ''))
  shown.forEach((text, i) => expect(text.startsWith(EXPECTED_ITEMS[i])).toBe(true))
}

const noPageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

for (const { name, target } of [
  { name: 'iPhone (mobile WebKit)', target: IPHONE },
  { name: 'Pixel (mobile Chromium)', target: PIXEL },
]) {
  test.describe(name, () => {
    test.beforeEach(({ browserName }) => test.skip(browserName !== target.engine, `${name} runs in ${target.engine}`))

    test('moves on the first visit, once delayed data arrives, with no interaction', async ({ browser }) => {
      const { ctx, page } = await openHome(browser, target.device, 1_000)
      await expectOnlyApiData(page)
      await expectMoving(page)
      // The painted ticker changes too, not only its layout position.
      const before = await ticker(page).screenshot({ animations: 'allow' })
      await expect.poll(async () => before.equals(await ticker(page).screenshot({ animations: 'allow' })), { timeout: 8_000 }).toBe(false)
      expect(await noPageOverflow(page)).toBe(true)
      await ctx.close()
    })

    test('a tap on the ticker does not leave it paused', async ({ browser }) => {
      const { ctx, page } = await openHome(browser, target.device)
      await expectMoving(page)
      await ticker(page).tap()
      await expectMoving(page)
      await ctx.close()
    })

    test('keeps moving after navigating away and back', async ({ browser }) => {
      const { ctx, page } = await openHome(browser, target.device)
      await expectMoving(page)
      await page.goto('/about', { waitUntil: 'domcontentloaded' })
      await page.goBack({ waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/$/)
      await expectMoving(page)
      await ctx.close()
    })

    for (const width of [375, 390]) {
      test(`no horizontal page overflow at ${width}px`, async ({ browser }) => {
        const { ctx, page } = await openHome(browser, { ...target.device, viewport: { width, height: 800 } })
        await expectMoving(page)
        expect(await noPageOverflow(page)).toBe(true)
        const box = (await ticker(page).boundingBox())!
        expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(width)
        await ctx.close()
      })
    }

    test('reduced motion: a static, manually scrollable ticker with the same readings', async ({ browser }) => {
      const { ctx, page } = await openHome(browser, { ...target.device, reducedMotion: 'reduce' })
      const region = page.getByRole('region', { name: 'Economic data ticker' })
      await expect(region.locator('.whitespace-nowrap')).toHaveCount(EXPECTED_ITEMS.length)
      await expect(page.getByRole('marquee')).toHaveCount(0)
      expect(await region.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
      const scroller = region.locator(':scope > div').nth(1)
      const scrolled = await scroller.evaluate((el) => { el.scrollLeft = 120; return el.scrollLeft })
      expect(scrolled).toBeGreaterThan(0)
      expect(await noPageOverflow(page)).toBe(true)
      await ctx.close()
    })
  })
}

// The ticker could only get in the way of touch scrolling by restricting touch-action (it adds no
// touch listeners). A synthesised DevTools scroll gesture was tried here, but Linux headless
// Chromium on CI did not apply it to a scrollable page, so the property itself is checked.
for (const { name, target } of [{ name: 'iPhone', target: IPHONE }, { name: 'Pixel', target: PIXEL }]) {
  test(`${name}: the ticker leaves touch scrolling to the browser`, async ({ browser, browserName }) => {
    test.skip(browserName !== target.engine, `${name} runs in ${target.engine}`)
    const { ctx, page } = await openHome(browser, target.device)
    await expectMoving(page)
    const restricted = await ticker(page).evaluate((root) =>
      [root, ...root.querySelectorAll('*')].map((el) => getComputedStyle(el).touchAction).filter((value) => value !== 'auto'))
    expect(restricted).toEqual([])
    await ctx.close()
  })
}

test('desktop: scrolls, pauses while the mouse is over it and resumes when it leaves', async ({ browser }) => {
  const { ctx, page } = await openHome(browser, { viewport: { width: 1280, height: 800 } }, 1_000)
  await expectOnlyApiData(page)
  await expectMoving(page)
  const box = (await ticker(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => page.evaluate(() => document.querySelector('[role="marquee"] div[style*="consilium-ticker"]')!.getAnimations()[0]?.playState)).toBe('paused')
  await page.mouse.move(box.x + box.width / 2, box.y + 400)
  await expectMoving(page)
  expect(await noPageOverflow(page)).toBe(true)
  await ctx.close()
})
