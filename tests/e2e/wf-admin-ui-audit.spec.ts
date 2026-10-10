import { test, expect, type Page } from '@playwright/test'
import { signedIn, closeDb, createAccount, removeMyAccounts } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Accessibility and layout floor for every screen this work added or moved into the shared frame:
 * one h1, every control has an accessible name, no console errors, and no sideways page scroll at phone width.
 */
test.afterAll(async () => { await removeMyAccounts(); await closeDb() })

const PAGES = ['/editorial', '/editorial/members', '/editorial/debates', '/editorial/debates/new', '/admin/testing', '/admin/subscribers', '/admin/login-attempts', '/admin/data']
const SHOTS = process.env.AUDIT_SHOTS_DIR

async function inspect(page: Page) {
  return page.evaluate(() => {
    const name = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el as HTMLElement).innerText || el.getAttribute('title') || '').trim()
    const unlabeled: string[] = []
    for (const el of document.querySelectorAll('button, a[href], [role=button]')) if (!name(el) && !el.querySelector('img[alt]')) unlabeled.push(el.outerHTML.slice(0, 100))
    for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      const id = el.id
      const labelled = (id && document.querySelector('label[for="' + id + '"]')) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      if (!labelled) unlabeled.push(el.outerHTML.slice(0, 100))
    }
    return { unlabeled, h1: document.querySelectorAll('h1').length, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
}

for (const [width, height, label] of [[1440, 1000, 'desktop'], [390, 844, 'phone']] as const) {
  test(`${label}: every new or moved screen is labelled, quiet and fits the screen`, async ({ browser }) => {
    test.setTimeout(180_000)
    const account = await createAccount('WRITER', 'uiaudit')
    const ctx = await signedIn(browser, 'admin')
    const page = await ctx.newPage()
    const errors = collectConsoleErrors(page)
    await page.setViewportSize({ width, height })
    for (const url of PAGES) {
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Decline' }).click({ timeout: 800 }).catch(() => {})
      const r = await inspect(page)
      expect(r.h1, `${url} has exactly one h1`).toBe(1)
      expect(r.unlabeled, `${url} unlabeled controls`).toEqual([])
      expect(r.overflowX, `${url} scrolls sideways by ${r.overflowX}px at ${width}px`).toBeLessThanOrEqual(0)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}${url.replace(/\//g, '_')}.png` })
    }
    // The open Team Members panel, which adds the tabs, the profile form and the preview.
    await page.goto('/editorial/members', { waitUntil: 'networkidle' })
    await page.getByLabel('Search').fill(account.email)
    await page.getByTestId(`member-${account.email}`).getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: 'Public profile' }).click()
    await page.getByRole('button', { name: 'Create a new profile' }).click()
    const r = await inspect(page)
    expect(r.unlabeled, 'open panel unlabeled controls').toEqual([])
    expect(r.overflowX, 'open panel scrolls sideways').toBeLessThanOrEqual(0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}_members_open.png`, fullPage: true })
    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
    await ctx.close()
  })
}

test('the new-debate form: every label is bound to its control, errors are announced and focus lands on the first problem', async ({ browser }) => {
  test.setTimeout(120_000)
  const ctx = await signedIn(browser, 'admin')
  const page = await ctx.newPage()
  await page.goto('/editorial/debates/new', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Decline' }).click({ timeout: 800 }).catch(() => {})

  // Every visible <label> inside the form points at a real control, and every control is reachable by its label text.
  const dangling = await page.evaluate(() => [...document.querySelectorAll('form label[for]')].filter((l) => !document.getElementById(l.getAttribute('for')!)).map((l) => l.textContent))
  expect(dangling).toEqual([])
  for (const label of ['Debate Question / Title *', 'Description (optional)', 'Category (optional)', 'Closes At (optional)']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(1)
  }
  await expect(page.getByLabel('Article Title *', { exact: true })).toHaveCount(2)
  await expect(page.getByLabel('Author *', { exact: true })).toHaveCount(2)
  await expect(page.getByLabel('Excerpt (optional)', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'For article body' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Against article body' })).toBeVisible()

  // Clicking a label focuses its control (the association works for a pointer, not just a screen reader).
  await page.getByText('Description (optional)', { exact: true }).click()
  await expect(page.getByLabel('Description (optional)', { exact: true })).toBeFocused()

  // Keyboard: Tab from the question reaches the description, then the category.
  await page.getByLabel('Debate Question / Title *', { exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Description (optional)', { exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Category (optional)', { exact: true })).toBeFocused()

  // Submitting with the browser's own required-field check satisfied but the bodies empty: one alert names what is missing,
  // marks the empty title fields invalid, and moves focus to the first problem.
  await page.getByLabel('Debate Question / Title *', { exact: true }).fill('Should this form be accessible?')
  await page.getByLabel('Article Title *', { exact: true }).nth(0).fill('For')
  await page.getByLabel('Article Title *', { exact: true }).nth(1).fill('Against')
  await page.getByRole('button', { name: 'Create Debate' }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'Please complete' })
  await expect(alert).toContainText('For article body')
  await expect(alert).toContainText('Against article body')
  await expect(page.getByRole('textbox', { name: 'For article body' })).toBeFocused()
  await ctx.close()
})
