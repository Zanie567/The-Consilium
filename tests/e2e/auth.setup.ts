import { test as setup, expect } from '@playwright/test'
import {
  ADMIN_STORAGE,
  EDITOR_GLOBAL_STORAGE,
  EDITOR_SCOPED_STORAGE,
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
  await page.waitForURL(/\/editorial(\/|$|\?)/, { timeout: 20_000 })
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

  await page.waitForURL(/\/editorial(\/|$|\?)/, { timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/editorial\/login/)
  await page.context().storageState({ path: storagePath })
}

setup('authenticate as an editor with no category assignments', async ({ page }) => {
  await authenticateEditor(page, 'editor.global@consilium.test', EDITOR_GLOBAL_STORAGE)
})

setup('authenticate as an editor scoped to Opinion', async ({ page }) => {
  await authenticateEditor(page, 'editor.opinion@consilium.test', EDITOR_SCOPED_STORAGE)
})
