import { assertSafeTestDatabaseHost } from './assertSafeTestDatabaseHost'
/** Attest one owned disposable database across app, fixtures, helpers and cleanup. */
export function assertRunDatabase(env: Record<string,string|undefined> = process.env): void {
  const url = env.TEST_DATABASE_URL
  assertSafeTestDatabaseHost(url, 'TEST_DATABASE_URL', {env})
  if (!url || url !== env.DATABASE_URL || url !== env.DIRECT_URL) throw new Error('App and helpers must share TEST_DATABASE_URL exactly')
  const run = env.E2E_RUN_ID ?? ''
  if (!/^next-e2e-[0-9]+-[0-9]+$/.test(run) || new URL(url).pathname !== '/consilium_audit_' + run.replaceAll('-', '_')) throw new Error('Database is not disposable and owned by this run')
}
