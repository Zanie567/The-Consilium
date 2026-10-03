import { test as setup, expect } from '@playwright/test'

/**
 * "Signed in" means the browser has LEFT the login page. The old pattern,
 * /\/editorial(\/|$|\?)/, also matched /editorial/login itself, so it returned at once and
 * the assertion after it raced the sign-in: it failed whenever sign-in took longer than
 * the assertion timeout, and a genuinely failed sign-in could look like success.
 */
const leftLoginPage = (url: URL) => !url.pathname.includes('/login')
import {
  ADMIN_STORAGE,
  EDITOR_GLOBAL_STORAGE,
  EDITOR_SCOPED_STORAGE,
  GROWTH_STORAGE,
  READER_STORAGE,
  WRITER_STORAGE,
} from './helpers/authStorage'

/**
 * Logs in as the seeded admin and saves the session so the editorial project can
 * reuse it. Credentials default to the seed admin; override with E2E_ADMIN_*.
 */
setup('authenticate as admin', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@theconsilium.com'
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'consilium2024'

  await page.goto('/editorial/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  // Land on the dashboard (not bounced back to /login).
  await page.waitForURL(leftLoginPage, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/editorial\/login/)
  await page.context().storageState({ path: ADMIN_STORAGE })
})

/**
 * Editor sessions for `editor-scope.spec.ts`. Both accounts come from
 * seed-test-fixtures.ts: one with no category assignments (the state every
 * EDITOR on production is in) and one confined to Opinion.
 */
async function authenticateEditor(
  page: import('@playwright/test').Page,
  email: string,
  storagePath: string
) {
  await page.goto('/editorial/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(
    process.env.E2E_EDITOR_PASSWORD ?? 'editor1234'
  )
  await page.locator('button[type="submit"]').click()

  await page.waitForURL(leftLoginPage, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/editorial\/login/)
  await page.context().storageState({ path: storagePath })
}

setup('authenticate as an editor with no category assignments', async ({ page }) => {
  await authenticateEditor(page, 'editor.global@consilium.test', EDITOR_GLOBAL_STORAGE)
})

setup('authenticate as an editor scoped to Opinion', async ({ page }) => {
  await authenticateEditor(page, 'editor.opinion@consilium.test', EDITOR_SCOPED_STORAGE)
})

/**
 * Writer session for publication-lifecycle.spec.ts (draft/submit/edit steps).
 * Credentials come from prisma/seed.ts; override with E2E_WRITER_*.
 */
setup('authenticate as the seeded writer', async ({ page }) => {
  const email = process.env.E2E_WRITER_EMAIL ?? 'writer@theconsilium.com'
  const password = process.env.E2E_WRITER_PASSWORD ?? 'writer2024'

  await page.goto('/editorial/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  await page.waitForURL(leftLoginPage, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/editorial\/login/)
  await page.context().storageState({ path: WRITER_STORAGE })
})

/**
 * Growth and reader sessions for the role-matrix specs. Both accounts come from
 * seed-test-fixtures.ts. A reader signs in through the public form (/login) and has
 * no portal access; growth signs in through the editorial form.
 */
setup('authenticate as growth', async ({ page }) => {
  await page.goto('/editorial/login')
  await page.locator('input[type="email"]').fill('growth@consilium.test')
  await page.locator('input[type="password"]').fill('reader1234')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(leftLoginPage, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/editorial\/login/)
  await page.context().storageState({ path: GROWTH_STORAGE })
})

setup('authenticate as a reader', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('reader.alice@consilium.test')
  await page.locator('input[type="password"]').fill('reader1234')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await page.context().storageState({ path: READER_STORAGE })
})
