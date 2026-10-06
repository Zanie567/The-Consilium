import { defineConfig, devices } from '@playwright/test'
import { ADMIN_STORAGE, EDITOR_GLOBAL_STORAGE } from './tests/e2e/helpers/authStorage'
import { applyTestDatabaseEnv, resolveTestBaseUrl } from './scripts/lib/testDatabase'
import { assertRunDatabase } from './scripts/lib/assertRunDatabase'
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
assertRunDatabase()

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
const resultsDir = process.env.E2E_RESULTS_DIR ?? 'test-results'
const reportDir = `playwright-report/${process.env.E2E_RUN_ID ?? 'manual'}`
const isWorkflow = (name: string) => name.startsWith('wf-')
const inPhase = (name: string) => {
  if (phase === 'team-profile') return name === 'team-profile'
  if (phase === 'workflow') return name === 'setup' || isWorkflow(name)
  if (phase === 'main') return name !== 'team-profile' && !isWorkflow(name)
  return true
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  outputDir: `${resultsDir}/${phase ?? 'selected'}`,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${reportDir}/${phase ?? 'selected'}` }],
    ['json', { outputFile: `${resultsDir}/${phase ?? 'selected'}/results.json` }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    // A control that cannot be clicked within 10s is a defect to report, not a reason to
    // sit for the rest of the test timeout.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    baseURL: BASE_URL,
    // A failure in CI must leave evidence: a trace (DOM snapshots, network, console) and a
    // screenshot of the failing step, including a first local failure.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: ([
    // Part of every run now: scripts/run-e2e.sh always provides the local storage
    // server and a build pointed at it. The specs share that one server and assert on
    // its contents, so they run serially (see `workers` in the project's spec files).
    {
      name: 'team-profile',
      testMatch: /(team-profile(-lifecycle)?|member-onboarding)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'public',
      testMatch: /(public|network-crawl|footnotes)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The public pages on the WebKit engine (Safari). network-crawl is browser-independent
      // (plain HTTP), so it stays on the Chromium project only.
      //
      // Keep footnotes and view-transition checks enabled: failures retain evidence.
      name: 'public-webkit',
      testMatch: /(public|footnotes)\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
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
    // ── Browser workflow suites (real clicks; see tests/e2e/wf-*.spec.ts) ────────────
    // Desktop Chromium and WebKit run the full set; the mobile projects run the
    // layout-sensitive subset. Each spec opens its own per-role contexts, so there is
    // no project-level storageState. They run as their own phase because they publish
    // and unpublish articles, which the public count assertions must not race with.
    {
      // New desktop workflow files must be selected automatically. Only the
      // device-configured phone-only spec belongs exclusively to mobile projects.
      name: 'wf-chromium',
      testMatch: /wf-(?!mobile\.spec\.ts$)[^/]+\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'wf-webkit',
      testMatch: /wf-(?!mobile\.spec\.ts$)[^/]+\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'wf-mobile-chromium',
      testMatch: /wf-mobile\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'wf-mobile-webkit',
      testMatch: /wf-mobile\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['iPhone 14'] },
    },
  ]).filter((project) => inPhase(project.name)),
})
