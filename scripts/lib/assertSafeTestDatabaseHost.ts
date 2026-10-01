/**
 * Fail-closed guard against the test harness ever reaching a hosted/production
 * database. Call this before any destructive setup step (schema push, seed,
 * dedupe) that connects using an env-supplied connection string.
 *
 * Default-deny: a host must be localhost/127.0.0.1/::1, or exactly match
 * TEST_DB_ALLOW_HOST (an explicit CI opt-in for a non-local test database).
 * Hosted-Supabase hostname patterns are blocked unconditionally — not even
 * TEST_DB_ALLOW_HOST can permit them — because that is the one destination
 * this guard exists to rule out.
 */

const PRODUCTION_HOST_PATTERNS = [/supabase\.co$/i, /supabase\.com$/i, /pooler\.supabase\.com$/i]

export function assertSafeTestDatabaseHost(connectionString: string | undefined, label: string): void {
  if (!connectionString) {
    throw new Error(`Refusing to continue: ${label} is not set.`)
  }

  let host: string
  try {
    host = new URL(connectionString).hostname
  } catch {
    throw new Error(`Refusing to continue: ${label} is not a valid connection URL.`)
  }

  if (PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new Error(
      `Refusing to continue: ${label} resolves to "${host}", which looks like a hosted ` +
        `Supabase/production database. The test harness must never connect to it.`
    )
  }

  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  const allowedCiHost = process.env.TEST_DB_ALLOW_HOST
  const isAllowedCiHost = Boolean(allowedCiHost) && host === allowedCiHost

  if (!isLocalhost && !isAllowedCiHost) {
    throw new Error(
      `Refusing to continue: ${label} resolves to "${host}", which is neither localhost/127.0.0.1 ` +
        `nor the host explicitly allow-listed via TEST_DB_ALLOW_HOST. Set TEST_DB_ALLOW_HOST to the ` +
        `exact CI test-database host if this is intentional.`
    )
  }
}
