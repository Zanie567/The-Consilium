import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const PORT = process.env.E2E_PORT ?? '3000'
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
const ADMIN_STORAGE = path.join(__dirname, 'tests/e2e/.auth/admin.json')

/**
 * E2E config. Tests run against a production server (`next start`) so caching and
 * RSC behaviour match the real deployment (relevant to the Priority 2 prefetch
 * tests). The DB must be seeded first — `npm run test:setup-db`.
 *
 * By default Playwright starts the server itself; set E2E_BASE_URL to point at an
 * already-running server and the webServer block is skipped.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'public',
      testMatch: /(public|network-crawl)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'editorial',
      testMatch: /editorial\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STORAGE },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start -- -p ' + PORT,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
