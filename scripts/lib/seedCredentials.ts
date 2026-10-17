/**
 * Passwords for seeded and fixture accounts.
 *
 * The seed scripts' built-in fixture passwords are for the automated test suites on a disposable LOCAL database
 * only. This module decides when they may be used:
 *
 *   - target database on a loopback host (localhost, 127.0.0.1, ::1): the built-in fixture password is used;
 *   - any other target: the password must come from the named environment variable and be at least 16 characters;
 *     otherwise seeding refuses to start.
 *
 * Nothing here ever prints a password.
 */

export type FixtureAccount = 'admin' | 'writer' | 'testingWorkspace'

export const SEED_PASSWORD_ENV: Record<FixtureAccount, string> = {
  admin: 'SEED_ADMIN_PASSWORD',
  writer: 'SEED_WRITER_PASSWORD',
  testingWorkspace: 'TESTING_FIXTURE_PASSWORD',
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false
  try {
    const url = new URL(databaseUrl)
    // A host= / hostaddr= parameter would make a driver ignore the URL's hostname.
    if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) return false
    return LOOPBACK_HOSTS.has(decodeURIComponent(url.hostname).toLowerCase())
  } catch {
    return false
  }
}

/** The password to set on a non-local database: from the environment, at least 16 characters. */
export function requireSeedPassword(account: FixtureAccount, env: Record<string, string | undefined> = process.env): string {
  const variable = SEED_PASSWORD_ENV[account]
  const supplied = env[variable]
  if (!supplied) {
    throw new Error(
      `Refusing to seed the "${account}" account on a non-local database with the built-in fixture password. ` +
        `Set ${variable} to a new password of at least 16 characters (it is never printed).`,
    )
  }
  if (supplied.length < 16) throw new Error(`${variable} must be at least 16 characters.`)
  if (account === 'testingWorkspace' && supplied === 'testing-local-1234') {
    throw new Error(`${variable} must differ from the built-in testing-workspace fixture password.`)
  }
  return supplied
}
