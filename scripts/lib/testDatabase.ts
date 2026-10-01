/**
 * Which database do tests use?  (WHETHER it is safe is decided only by
 * assertSafeTestDatabaseHost.ts — nothing here re-implements those rules.)
 *
 * TEST_DATABASE_URL is the single source of truth. When it is unset the default is
 * the local cluster that scripts/setup-test-db.sh creates. DATABASE_URL and
 * DIRECT_URL — from the shell or from .env.local, which points at production — are
 * never read; they are OVERWRITTEN with the verified URL, so a stray production URL
 * cannot leak into a test run.
 */
import { assertSafeTestDatabaseHost } from './assertSafeTestDatabaseHost'

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres@localhost:5433/consilium'
const DEFAULT_TEST_BASE_URL = 'http://localhost:3000'
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

type Env = Record<string, string | undefined>

/** The verified test database URL. Throws if it is not safe. */
export function resolveTestDatabaseUrl(env: Env = process.env, root = process.cwd()): string {
  const url = (env.TEST_DATABASE_URL ?? '').trim() || DEFAULT_TEST_DATABASE_URL
  assertSafeTestDatabaseHost(url, 'TEST_DATABASE_URL', { env, root })
  return url
}

/** The variables that point Prisma, the tests and the seeds at the verified database. */
export function testDatabaseEnv(env: Env = process.env, root = process.cwd()) {
  const url = resolveTestDatabaseUrl(env, root)
  return { DATABASE_URL: url, DIRECT_URL: url, TEST_DATABASE_URL: url }
}

/** Overwrites `env` with the verified database. Call before anything reads it. */
export function applyTestDatabaseEnv(env: Env = process.env, root = process.cwd()): void {
  Object.assign(env, testDatabaseEnv(env, root))
}

/**
 * E2E and live-server tests are driven over HTTP and write data, so refuse a
 * remote site (it could be production). TEST_BASE_URL_ALLOW_HOST is the deliberate,
 * exact-host opt-in, mirroring TEST_DB_ALLOW_HOST.
 */
export function resolveTestBaseUrl(value: string | undefined, env: Env = process.env): string {
  const base = (value ?? '').trim() || DEFAULT_TEST_BASE_URL
  let host: string
  try {
    host = new URL(base).hostname.toLowerCase()
  } catch {
    throw new Error('Refusing to continue: the test base URL is not a valid URL.')
  }
  if (!LOOPBACK.has(host) && host !== (env.TEST_BASE_URL_ALLOW_HOST ?? '').toLowerCase()) {
    throw new Error(
      `Refusing to run tests against "${host}": a remote site could be production. Use a local ` +
        `server started against the test database (scripts/run-audit.sh), or set ` +
        `TEST_BASE_URL_ALLOW_HOST to the exact host if this is intentional.`,
    )
  }
  return base
}
