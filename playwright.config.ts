import { defineConfig, devices } from '@playwright/test'
import { ADMIN_STORAGE, EDITOR_GLOBAL_STORAGE } from './tests/e2e/helpers/authStorage'
import { applyTestDatabaseEnv, resolveTestBaseUrl } from './scripts/lib/testDatabase'
import { assertIsolatedServiceEnv } from './scripts/lib/testServices'

// SAFETY: E2E signs in with seeded credentials and writes data, and the e2e DB
// helpers read DATABASE_URL. Pin both the process and the server it starts to the
// verified local test database (never .env.local = production), and refuse a remote
// base URL. Runs in every Playwright worker too, since each re-imports this config.
applyTestDatabaseEnv()
// Storage, email and OAuth are just as dangerous as the database: `next build` and
// `next start` read .env.local (production keys) for anything not set explicitly.
// scripts/run-e2e.sh sets every one of them to a local stand-in; refuse to run
// without it. Re-checked in each worker, which re-imports this file.
assertIsolatedServiceEnv()

if (!process.env.E2E_BASE_URL) {
  throw new Error('E2E_BASE_URL is not set. Run the suite with `npm run test:e2e` (scripts/run-e2e.sh).')
}
const BASE_URL = resolveTestBaseUrl(process.env.E2E_BASE_URL)

/**
 * E2E config. Tests run against a production server (`next start`) so caching and
 * RSC behaviour match the real deployment (relevant to the Priority 2 prefetch
 * tests). The DB must be seeded first — `npm run test:setup-db`.
 *
 * The server is started by scripts/run-e2e.sh, not by Playwright: only that script
 * builds the app with the isolated storage/email environment, and a server started
 * any other way could carry production keys from .env.local.
 */
// scripts/run-e2e.sh runs the team-profile specs separately (E2E_PHASE=team-profile)
// from everything else (E2E_PHASE=main). Unset = every project, for explicit
// `--project=...` selections.
const phase = process.env.E2E_PHASE
const inPhase = (name: string) =>
  phase === 'main' ? name !== 'team-profile' : phase === 'team-profile' ? name === 'team-profile' : true

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
  projects: ([
    // Part of every run now: scripts/run-e2e.sh always provides the local storage
    // server and a build pointed at it. The specs share that one server and assert on
    // its contents, so they run serially (see `workers` in the project's spec files).
    {
      name: 'team-profile',
      testMatch: /team-profile(-lifecycle)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
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
  ]).filter((project) => inPhase(project.name)),
})
