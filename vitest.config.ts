import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // E2E specs live in tests/e2e and use @playwright/test, not vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    // Forward the live-server base URL (and seed credentials) into the test
    // workers. Read here in the main process — where an inline `BASE_URL=…`
    // prefix is reliably visible — so integration specs can reach the server
    // regardless of how vitest pools/forks workers.
    env: {
      BASE_URL: process.env.BASE_URL ?? 'http://localhost:3000',
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
