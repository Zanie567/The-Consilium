import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { collectConsoleErrors } from './helpers/console'

/**
 * The EconSoc Trading Challenge page (/trading-challenge), on desktop Chromium and
 * WebKit (wf-chromium / wf-webkit), plus phone-sized contexts created here.
 *
 * Google Forms is never contacted: every docs.google.com request is fulfilled
 * locally, so these checks exercise the page's own loading rules and the CSP
 * frame-src allowance (which applies to the URL whether or not it is stubbed).
 */

const RESPONDER = 'https://docs.google.com/forms/d/e/1FAIpQLSeC6thVEEGseljEprbWRaGXqBUuDhfunC_5YzW7DqLy0ZT7zA/viewform'
const EMBED = `${RESPONDER}?embedded=true`
const MEMBERSHIP = 'https://www.eusa.ed.ac.uk/activities/view/economicssoc'

async function stubGoogleForms(context: BrowserContext) {
  const requests: string[] = []
  await context.route(/^https:\/\/docs\.google\.com\//, (route) => {
    requests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stub form</title><h1>Stub registration form</h1>' })
  })
  return requests
}

async function open(page: Page, consent: 'accepted' | 'declined' = 'declined', path = '/trading-challenge') {
  await page.addInitScript((value) => localStorage.setItem('consilium_cookie_consent', value), consent)
  const response = await page.goto(path, { waitUntil: 'networkidle' })
  expect(response?.status()).toBe(200)
  return response!
}

const studentFrame = (page: Page) => page.locator('iframe[title="EconSoc Trading Challenge student registration form (Google Forms)"]')

test('Trading appears in the desktop navigation between Debate and About and opens the page', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await stubGoogleForms(page.context())
  await open(page, 'declined', '/')
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true })
  await expect(nav.getByRole('link')).toHaveText(['Home', 'News', 'Opinion', 'Analysis', 'Interviews', 'Debate', 'Trading', 'About'])
  await nav.getByRole('link', { name: 'Trading', exact: true }).click()
  await page.waitForURL('**/trading-challenge')
  await expect(page.getByRole('heading', { level: 1, name: 'Think you can beat the market?' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Trading', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(errors, errors.join('\n')).toEqual([])
})

test('the page states the confirmed competition facts and never a password or private sheet', async ({ page }) => {
  const response = await open(page)
  const html = await response.text()
  const main = page.locator('main')
  await expect(main.getByText('$100,000').first()).toBeVisible()
  await expect(main.getByText('£175').first()).toBeVisible()
  for (const [place, amount] of [['First place', '£100'], ['Second place', '£50'], ['Third place', '£25']]) {
    const item = page.getByRole('list', { name: 'Prizes' }).getByRole('listitem').filter({ hasText: place })
    await expect(item).toContainText(amount)
  }
  // The essentials only, prizes included; detailed MarketWatch settings are not restated.
  const glance = page.locator('dl.trading-glance')
  await expect(glance.locator('div').filter({ hasText: /^Competition dates/ })).toContainText(/Starts28 October 2026\s*Ends25 March 2027/)
  await expect(glance.locator('div').filter({ hasText: /^Markets/ })).toContainText('Nasdaq, NYSE, NYSE American and OTC')
  await expect(glance.locator('div').filter({ hasText: /^Prizes/ })).toContainText(/First£100.*Second£50.*Third£25/)
  for (const gone of ['Commission', 'Short selling', 'Margin trading', 'Fractional shares', 'Minimum share price']) {
    await expect(main.getByText(gone)).toHaveCount(0)
  }
  expect(html).not.toMatch(/docs\.google\.com\/spreadsheets|script\.google\.com|game password\s*[:=]/i)
  expect(html).toContain('Illustrative chart. Not market data or competition results.')
})

test('the Google Form is not loaded until the visitor asks for it', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const requests = await stubGoogleForms(page.context())
  await open(page, 'declined')
  await page.locator('#register').scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await expect(studentFrame(page)).toHaveCount(0)
  expect(requests).toEqual([])
  // The direct route is always available and opens safely in a new tab.
  const direct = page.getByRole('link', { name: /Open in Google Forms/ }).first()
  await expect(direct).toHaveAttribute('href', RESPONDER)
  await expect(direct).toHaveAttribute('target', '_blank')
  await expect(direct).toHaveAttribute('rel', /noopener/)

  await page.getByRole('button', { name: 'Load the form here' }).click()
  await expect(studentFrame(page)).toHaveAttribute('src', EMBED)
  await expect(page.frameLocator('iframe[title*="student registration form"]').getByRole('heading', { name: 'Stub registration form' })).toBeVisible()
  expect(requests.some((url) => url.startsWith(EMBED))).toBe(true)
  // The page never claims a submission happened.
  await expect(page.locator('main')).not.toContainText(/registration (successful|complete)|you('| a)re registered/i)
  expect(errors, errors.join('\n')).toEqual([])
})

test('"Enter the Challenge" jumps to registration and loads the form; "How it works" jumps to the steps', async ({ page }) => {
  await stubGoogleForms(page.context())
  await open(page, 'declined')
  await page.getByRole('link', { name: 'How it works' }).click()
  await expect(page).toHaveURL(/#how-it-works$/)
  await expect(page.getByRole('heading', { name: 'How to enter' })).toBeInViewport()
  await page.getByRole('link', { name: 'Enter the Challenge' }).first().click()
  await expect(page).toHaveURL(/#register$/)
  await expect(page.getByRole('heading', { name: 'Register for the Challenge', exact: true })).toBeInViewport()
  await expect(studentFrame(page)).toHaveAttribute('src', EMBED)
})

test('with cookie consent the form loads as the registration section approaches', async ({ page }) => {
  const requests = await stubGoogleForms(page.context())
  await open(page, 'accepted')
  await expect(studentFrame(page)).toHaveCount(0)
  expect(requests).toEqual([])
  await page.getByRole('heading', { name: 'How to enter' }).scrollIntoViewIfNeeded()
  await page.locator('#register').scrollIntoViewIfNeeded()
  await expect(studentFrame(page)).toHaveAttribute('src', EMBED)
})

test('non-student members are asked to email the committee, with a prefilled message and no form', async ({ page }) => {
  const requests = await stubGoogleForms(page.context())
  // This test is about the two routes, not motion (the hero chart test below covers that). With
  // motion on, the first click scrolls the parked registration panel into view, which replays its
  // reveal animation, and in CI's WebKit the second click then landed while the cards were still
  // moving and the page was smooth-scrolling (scrollTop 1969 → 1912 within 25 ms of the click), so
  // the pointer left the card before mouseup and no click was delivered. Reduced motion removes
  // the reveal replay, the panel animation and smooth scrolling.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  const choice = page.getByRole('group', { name: 'Which describes you?' })
  // The radios are visually hidden inside their cards; people click the card (label).
  await choice.getByText('I’m a non-student EconSoc member').click()
  await expect(choice.getByRole('radio', { name: /non-student EconSoc member/ })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Not a University of Edinburgh student?' })).toBeVisible()
  await expect(page.getByText(/opening soon|isn’t open yet/i)).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  const contact = page.getByRole('link', { name: 'Contact EconSoc to Register' })
  const href = (await contact.getAttribute('href')) ?? ''
  const url = new URL(href)
  expect(url.protocol).toBe('mailto:')
  expect(url.pathname).toBe('economics.society@ed.ac.uk')
  expect(url.searchParams.get('subject')).toBe('Trading Challenge – Non-Student Registration')
  expect(url.searchParams.get('body')).toMatch(/Full name:[\s\S]*MarketWatch display name:[\s\S]*Email address used to buy my EconSoc membership:/)
  expect(url.searchParams.get('body')).not.toMatch(/password/i)
  await expect(page.getByText('Never send a password.')).toBeVisible()
  const membership = page.getByRole('link', { name: 'Buy EconSoc membership (opens EUSA in a new tab)', exact: true })
  await expect(membership).toHaveAttribute('href', MEMBERSHIP)
  await expect(membership).toHaveAttribute('rel', /noopener/)
  // Switching back restores the student route.
  await choice.getByText('I’m a University of Edinburgh student').click()
  await expect(page.getByRole('heading', { name: 'Student registration' })).toBeVisible()
  // Re-choosing the student route is explicit intent, so its form loads (the iframe
  // requests it after the re-render, so wait for the request rather than reading once).
  await expect.poll(() => requests.some((u) => u.includes('/forms/'))).toBe(true)
})

/** Share of the trend currently drawn: the reveal clip's right edge across the plot. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const plot = document.querySelector('.trading-plot')!.getBoundingClientRect()
    const clip = document.querySelector('.trading-reveal')!.getBoundingClientRect()
    return (clip.right - plot.left) / plot.width
  })

test('the hero chart draws part of the trend on load and grows with scrolling', async ({ page }) => {
  await open(page)
  const scrollDriven = await page.evaluate(() => CSS.supports('animation-timeline: view()'))
  await page.waitForTimeout(2300) // the load stretch has finished drawing
  const atRest = await drawn(page)
  if (scrollDriven) {
    expect(atRest).toBeGreaterThan(0.3)
    expect(atRest).toBeLessThan(0.6)
    await page.mouse.wheel(0, 100)
    await expect.poll(() => drawn(page)).toBeGreaterThan(atRest + 0.1)
    await page.mouse.wheel(0, 200)
    await expect.poll(() => drawn(page)).toBeGreaterThan(0.99)
  } else {
    // No scroll-driven animations: the whole chart draws on load.
    expect(atRest).toBeGreaterThan(0.99)
  }
})

test('on phones the chart grows as it scrolls up into view', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const page = await ctx.newPage()
  await open(page)
  const scrollDriven = await page.evaluate(() => CSS.supports('animation-timeline: view()'))
  await page.waitForTimeout(2300)
  if (scrollDriven) {
    // Below the hero text, so barely started at rest...
    expect(await drawn(page)).toBeLessThan(0.4)
    // ...part way as it rises into view, and complete by the middle of the screen.
    await page.evaluate(() => window.scrollTo(0, 220))
    await expect.poll(() => drawn(page)).toBeGreaterThan(0.4)
    await page.evaluate(() => window.scrollTo(0, 500))
    await expect.poll(() => drawn(page)).toBeGreaterThan(0.99)
  } else {
    expect(await drawn(page)).toBeGreaterThan(0.99)
  }
  await ctx.close()
})

test('the podium waits for the reader, plays its entrance once and settles in order', async ({ page }) => {
  await open(page, 'declined')
  const podium = page.getByRole('list', { name: 'Prizes' })
  // Below the fold after hydration, so its entrance is held until it is seen.
  await expect(podium).toHaveAttribute('data-reveal-state', 'pending')
  await podium.scrollIntoViewIfNeeded()
  await expect(podium).not.toHaveAttribute('data-reveal-state', 'pending')
  // Every column ends in place and fully visible.
  await expect.poll(() =>
    podium.locator('li').evaluateAll((els) => els.map((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform])),
  ).toEqual([['1', 'none'], ['1', 'none'], ['1', 'none']])
  // Second, first, third from left to right.
  const lefts = await podium.locator('li').evaluateAll((els) => els.map((e) => [e.getAttribute('data-place'), e.getBoundingClientRect().left] as const))
  expect([...lefts].sort((a, b) => a[1] - b[1]).map((x) => x[0])).toEqual(['2', '1', '3'])
  // Scrolling away and back does not replay it.
  await page.evaluate(() => window.scrollTo(0, 0))
  await podium.scrollIntoViewIfNeeded()
  await expect(podium).not.toHaveAttribute('data-reveal-state', 'pending')
})

test('route choice and FAQ work from the keyboard', async ({ page }) => {
  await stubGoogleForms(page.context())
  await open(page)
  const student = page.getByRole('radio', { name: /University of Edinburgh student/ })
  await student.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: /non-student EconSoc member/ })).toBeChecked()
  const summary = page.locator('summary', { hasText: 'Do I need to invest real money?' })
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('All trading is simulated with virtual money on MarketWatch')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText('All trading is simulated with virtual money on MarketWatch')).toBeHidden()
})

test('every external link opens in a new tab without an opener', async ({ page }) => {
  await open(page)
  const external = page.locator('main a[href^="http"]')
  const count = await external.count()
  expect(count).toBeGreaterThan(4)
  for (let i = 0; i < count; i++) {
    await expect(external.nth(i)).toHaveAttribute('target', '_blank')
    await expect(external.nth(i)).toHaveAttribute('rel', /noopener/)
  }
})

test('reduced motion shows content immediately and the page has one h1 and landmarked sections', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await open(page)
  await expect(page.locator('h1')).toHaveCount(1)
  // The finished chart, with nothing left to draw.
  expect(await drawn(page)).toBeGreaterThan(0.99)
  const opacities = await page.locator('.consilium-reveal').evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))
  expect(opacities.every((o) => o === '1')).toBe(true)
  for (const name of ['Think you can beat the market?', 'How to enter', 'Standings', 'The rules', 'Questions']) {
    await expect(page.getByRole('region', { name })).toBeAttached()
  }
  await ctx.close()
})

for (const theme of ['light', 'dark'] as const) {
  test(`phone layout (${theme}): no horizontal overflow, Trading in the menu, form link reachable`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, colorScheme: theme })
    await stubGoogleForms(ctx)
    const page = await ctx.newPage()
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
    await open(page, 'declined', '/')
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    const menu = page.getByRole('navigation', { name: 'Mobile navigation' })
    await menu.getByRole('link', { name: 'Trading', exact: true }).click()
    await page.waitForURL('**/trading-challenge')
    await expect(page.locator('html')).toHaveClass(new RegExp(theme === 'dark' ? '\\bdark\\b' : '^(?!.*\\bdark\\b)'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    await page.getByRole('link', { name: 'Enter the Challenge' }).first().tap()
    await expect(page).toHaveURL(/#register$/)
    // Phones show the form before the "what happens next" notes.
    const direct = page.getByRole('link', { name: /Open in Google Forms/ }).first()
    await direct.scrollIntoViewIfNeeded()
    await expect(direct).toBeVisible()
    const formTop = await direct.evaluate((el) => el.getBoundingClientRect().top)
    const notesTop = await page.getByText('What happens next', { exact: true }).evaluate((el) => el.getBoundingClientRect().top)
    expect(formTop).toBeLessThan(notesTop)
    await ctx.close()
  })
}

test('below 1260px the bar uses the menu drawer, so the eight sections never overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const page = await ctx.newPage()
  await open(page)
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeVisible()
  expect(await page.locator('header > div').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await ctx.close()
})

test('the trading page is listed in the sitemap', async ({ request }) => {
  const body = await (await request.get('/sitemap.xml')).text()
  expect(body).toContain('/trading-challenge</loc>')
})
