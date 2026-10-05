import { defineConfig } from 'vitest/config'
import path from 'path'
import { resolveTestBaseUrl, testDatabaseEnv } from './scripts/lib/testDatabase'

// Fail closed, before any test is collected: tests only ever get a verified local
// database, never DATABASE_URL / .env.local (production). The rules live in
// scripts/lib/assertSafeTestDatabaseHost.ts; scripts/lib/testDatabase.ts picks the URL.
const testDatabase = testDatabaseEnv()
const baseUrl = resolveTestBaseUrl(process.env.BASE_URL)

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // Each database suite owns a pool. Bound concurrency so a full local audit
    // does not exhaust Postgres/CPU while its production app is also running.
    maxWorkers: 2,
    // E2E specs live in tests/e2e and use @playwright/test, not vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', ...(!(process.env.E2E_ISOLATED === '1' && process.env.BASE_URL) ? ['tests/integration/read-through-db.test.ts','tests/integration/api.test.ts','tests/integration/data-layer.test.ts','tests/integration/api-audit.test.ts','tests/integration/calendar-access.test.ts','tests/integration/team-profile-db.test.ts','tests/integration/team-profile-storage.test.ts'] : [])],
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
