/**
 * Second line of defence, run at the start of every Vitest worker.
 *
 * vitest.config.ts has already replaced DATABASE_URL / DIRECT_URL with the verified
 * test database. This re-checks them inside the worker, so a run that bypassed the
 * config (a different --config, an inherited override) still stops before any test
 * file can connect to something it should not.
 */
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { assertRunDatabase } from '../../scripts/lib/assertRunDatabase'
import { resolveTestBaseUrl } from '../../scripts/lib/testDatabase'

for (const key of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL'] as const) {
  const value = process.env[key]
  if (value) assertSafeTestDatabaseHost(value, key)
}
resolveTestBaseUrl(process.env.BASE_URL)
if (process.env.E2E_ISOLATED === '1') assertRunDatabase()
