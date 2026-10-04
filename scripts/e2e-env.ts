/**
 * Prints `export` lines for the isolated E2E stack (database + services):
 *   eval "$(npx ts-node -P tsconfig.seed.json scripts/e2e-env.ts)"
 * Exits non-zero, printing nothing to eval, if anything is unsafe.
 */
import { testDatabaseEnv } from './lib/testDatabase'
import { assertIsolatedServiceEnv, isolatedServiceEnv } from './lib/testServices'

try {
  const services = isolatedServiceEnv({
    appPort: Number(process.env.E2E_APP_PORT ?? 3200),
    storagePort: Number(process.env.FAKE_STORAGE_PORT ?? 54321),
    distDir: process.env.E2E_DIST_DIR,
    emailCaptureFile: process.env.EMAIL_CAPTURE_FILE ?? '/tmp/consilium-e2e-outbox.jsonl',
  })
  const database = testDatabaseEnv()
  let adminDatabase = ''
  if (process.env.E2E_CREATE_DATABASE === '1') {
    const run = process.env.E2E_RUN_ID ?? ''
    if (!/^next-e2e-[0-9]+-[0-9]+$/.test(run)) throw new Error('Invalid database ownership run ID')
    const url = new URL(database.TEST_DATABASE_URL)
    // PostgreSQL identifiers are derived only from our validated run ID.
    url.pathname = '/postgres'
    adminDatabase = url.toString()
    url.pathname = '/consilium_audit_' + run.replaceAll('-', '_')
    Object.assign(database, { TEST_DATABASE_URL: url.toString(), DATABASE_URL: url.toString(), DIRECT_URL: url.toString() })
  }
  const env = { ...database, ...services, ...(adminDatabase ? { E2E_ADMIN_DATABASE_URL: adminDatabase } : {}) }
  assertIsolatedServiceEnv(env)
  for (const [key, value] of Object.entries(env)) {
    process.stdout.write(`export ${key}='${value.replace(/'/g, `'\\''`)}'\n`)
  }
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exit(1)
}
