import { test as setup, expect } from '@playwright/test'
import path from 'path'

export const ADMIN_STORAGE = path.join(__dirname, '.auth/admin.json')

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
