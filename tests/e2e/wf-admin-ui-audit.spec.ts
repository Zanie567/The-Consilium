import { test, expect, type Page } from '@playwright/test'
import { signedIn, closeDb, createAccount, removeMyAccounts } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Accessibility and layout floor for every screen this work added or moved into the shared frame:
 * one h1, every control has an accessible name, no console errors, and no sideways page scroll at phone width.
 */
test.afterAll(async () => { await removeMyAccounts(); await closeDb() })

const PAGES = ['/editorial', '/editorial/members', '/editorial/debates', '/admin/testing', '/admin/subscribers', '/admin/login-attempts', '/admin/data']
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
