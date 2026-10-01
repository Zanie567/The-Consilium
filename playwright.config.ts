import { defineConfig, devices } from '@playwright/test'
import { ADMIN_STORAGE, EDITOR_GLOBAL_STORAGE } from './tests/e2e/helpers/authStorage'
import { applyTestDatabaseEnv, resolveTestBaseUrl } from './scripts/lib/testDatabase'

// SAFETY: E2E signs in with seeded credentials and writes data, and the e2e DB
// helpers read DATABASE_URL. Pin both the process and the server it starts to the
// verified local test database (never .env.local = production), and refuse a remote
// base URL. Runs in every Playwright worker too, since each re-imports this config.
applyTestDatabaseEnv()

const PORT = process.env.E2E_PORT ?? '3000'
const BASE_URL = resolveTestBaseUrl(process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`)

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
      testMatch: /(public|network-crawl|footnotes)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'editorial',
      testMatch: /editorial(-layout)?\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STORAGE },
    },
    {
      // Runs as an EDITOR rather than the admin; the spec overrides the state
      // per describe block for the scoped and unscoped editors.
      name: 'editor',
      testMatch: /editor-scope\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: EDITOR_GLOBAL_STORAGE },
    },
    {
      // Drives the full article lifecycle across writer/editor/public roles
      // within a single test, so it manages its own per-role API contexts
      // rather than using one project-level storageState.
      name: 'lifecycle',
      testMatch: /publication-lifecycle\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
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
