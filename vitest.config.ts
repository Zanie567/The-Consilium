import { defineConfig } from 'vitest/config'
import path from 'path'
import { resolveTestBaseUrl, testDatabaseEnv } from './scripts/lib/testDatabase'

// Fail closed, before any test is collected: tests only ever get a verified local
// database, never DATABASE_URL / .env.local (production). The rules live in
// scripts/lib/assertSafeTestDatabaseHost.ts; scripts/lib/testDatabase.ts picks the URL.
const testDatabase = testDatabaseEnv()
const baseUrl = resolveTestBaseUrl(process.env.BASE_URL)

// Suites that read or write a real database (and some also drive the live app). They only run under
// the isolated launcher (scripts/run-e2e.sh sets E2E_ISOLATED=1 and BASE_URL), which owns a disposable
// per-run database. A plain `vitest run` / `npm test` never collects them, so it can never touch one.
const DB_BACKED_SUITES = [
  'tests/integration/read-through-db.test.ts',
  'tests/integration/api.test.ts',
  'tests/integration/data-layer.test.ts',
  'tests/integration/api-audit.test.ts',
  'tests/integration/calendar-access.test.ts',
  'tests/integration/team-profile-db.test.ts',
  'tests/integration/team-profile-storage.test.ts',
  'tests/integration/member-onboarding.test.ts',
  'tests/integration/analytics-engagement.test.ts',
  'tests/integration/article-image-storage.test.ts',
  'tests/integration/article-revisions.test.ts',
  'tests/integration/discovery.test.ts',
  'tests/integration/growth-subscribe.test.ts',
  'tests/integration/scheduled-publication.test.ts',
  'tests/integration/debate-lifecycle-db.test.ts',
  'tests/integration/team-members-admin-db.test.ts',
  'tests/integration/testing-scenarios-db.test.ts',
  'tests/integration/hidden-debate-guard-db.test.ts',
  'tests/integration/admin-overhaul-migrations.test.ts',
]
const isolatedLauncherRun = process.env.E2E_ISOLATED === '1' && Boolean(process.env.BASE_URL)

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // Live HTTP and direct-DB files (only collected under the isolated launcher, see the
    // exclude list below) mutate the same seeded test database. Running those files
    // serially keeps count/roster assertions from racing another file's fixtures. The
    // default in-process run has no shared database, so it stays parallel.
    fileParallelism: process.env.E2E_ISOLATED !== '1',
    // Each database suite owns a pool. Bound concurrency so a full local audit
    // does not exhaust Postgres/CPU while its production app is also running.
    maxWorkers: 2,
    // E2E specs live in tests/e2e and use @playwright/test, not vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', ...(isolatedLauncherRun ? [] : DB_BACKED_SUITES)],
    // Forward the live-server base URL (and seed credentials) into the test
    // workers. Read here in the main process — where an inline `BASE_URL=…`
    // prefix is reliably visible — so integration specs can reach the server
    // regardless of how vitest pools/forks workers.
    setupFiles: ['./tests/setup/db-guard.ts'],
    env: {
      ...testDatabase,
      // In-process ordinary route tests have no Next request/cookie context.
      // Dedicated simulator suites explicitly enable it with their real DB mocks;
      // live/browser requests still exercise the enabled app server separately.
      TESTING_MODE_ENABLED: '0',
      BASE_URL: baseUrl,
      ...(process.env.E2E_ADMIN_EMAIL ? { E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL } : {}),
      ...(process.env.E2E_ADMIN_PASSWORD ? { E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD } : {}),
      ...(process.env.CRON_SECRET ? { CRON_SECRET: process.env.CRON_SECRET } : {}),
      // Test-side signal that the live server runs with the rate limiter off, so
      // the limiter-specific HTTP tests skip (the limiter logic is unit-tested).
      ...(process.env.AUDIT_NO_RATE_LIMIT ? { AUDIT_NO_RATE_LIMIT: process.env.AUDIT_NO_RATE_LIMIT } : {}),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
