/**
 * THE test-database safety policy. Every test, seed, fixture and E2E entry point
 * that can touch a database goes through this file; nothing else decides what is
 * safe (scripts/lib/testDatabase.ts only chooses WHICH url to check).
 *
 * Fail-closed guard against the test harness ever reaching a hosted/production
 * database. Call this before any destructive setup step (schema push, seed,
 * dedupe) that connects using an env-supplied connection string.
 *
 * Rules, in order:
 *   0. The URL may not carry a `host`, `hostaddr` or `service` query parameter, and its hostname must
 *      be valid percent-encoding. pg, psql (libpq) and Prisma's schema engine let those parameters
 *      REPLACE the URL's hostname (a remote host, or a unix-socket directory), and drivers decode
 *      %XX in the hostname, so every check below would otherwise be judging a host the driver never
 *      connects to. All checks below read the decoded hostname.
 *   1. A hosted-Supabase hostname is refused unconditionally — not even
 *      TEST_DB_ALLOW_HOST can permit it — because that is the one destination this
 *      guard exists to rule out.
 *   2. This repository's actual production Supabase project is refused unconditionally,
 *      however it is reached (direct host, pooler, "postgres.<ref>" username, a proxy):
 *      its ref is read from NEXT_PUBLIC_SUPABASE_URL / DATABASE_URL / DIRECT_URL in the
 *      environment and in .env.local.
 *   3. Default-deny: a host must be localhost/127.0.0.1/::1, or exactly match
 *      TEST_DB_ALLOW_HOST (an explicit CI opt-in for a non-local test database).
 *   4. A TEST database URL may carry only a short allowlist of harmless query parameters (nothing
 *      that changes the host, port, user or database a driver really uses: libpq honors `dbname=`
 *      over the URL path, pg and libpq honor `user=` and `port=`), and libpq environment variables
 *      that redirect a connection (PGHOSTADDR, PGSERVICE, PGSERVICEFILE) must be unset: psql applies
 *      PGHOSTADDR even when the URL names localhost.
 *
 * The production project is recognised by its ref appearing ANYWHERE in the decoded connection string
 * (host, username, database, query parameters such as user= or options=), not only in the two places
 * a pooler normally puts it.
 */
import fs from 'node:fs'
import path from 'node:path'

const PRODUCTION_HOST_PATTERNS = [/supabase\.co$/i, /supabase\.com$/i, /pooler\.supabase\.com$/i]

type Env = Record<string, string | undefined>
interface PolicyContext {
  env?: Env
  /** Directory holding .env.local. Defaults to the working directory. */
  root?: string
}

function readEnvFile(file: string): Env {
  try {
    const out: Env = {}
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Connection parameters that make a driver connect somewhere other than the URL's hostname. Matched
 * case-insensitively and wherever they appear in the query string.
 */
const HOST_OVERRIDE_PARAMS = new Set(['host', 'hostaddr', 'service', 'servicefile'])

/** The only query parameters a TEST database URL may carry; none changes host, port, user or database. */
const ALLOWED_QUERY_PARAMS = new Set(['schema', 'sslmode', 'pgbouncer', 'connection_limit', 'pool_timeout', 'connect_timeout', 'application_name'])
/**
 * Environment variables whose value can name the production project: node-postgres (the hand-run seeds
 * go through it) fills any component the URL lacks from these, e.g. PGUSER=postgres.<ref> with a pooler
 * URL that has no username. PGPASSWORD is deliberately not in the list: it is never read.
 */
const PRODUCTION_NAMING_ENV_VARS = ['PGHOST', 'PGUSER', 'PGDATABASE', 'PGOPTIONS', 'PGSERVICE']
/** libpq environment variables that redirect a connection even when the URL names a local host. */
const REDIRECTING_ENV_VARS = ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']

/** The hostname as drivers see it: percent-escapes decoded. Falls back to the raw text if malformed. */
function decodedHostname(url: URL): string {
  try {
    return decodeURIComponent(url.hostname)
  } catch {
    return url.hostname
  }
}

/** Percent-decodes text the way a driver would; returns it unchanged if it holds a stray `%`. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Supabase project ref(s) a URL points at: from `db.<ref>.supabase.co` or a `postgres.<ref>` pooler user. */
function supabaseRefs(value: string | undefined): string[] {
  if (!value) return []
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return []
  }
  const refs = new Set<string>()
  const fromHost = /^(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|com|net)$/i.exec(decodedHostname(url))
  if (fromHost) refs.add(fromHost[1].toLowerCase())
  const fromUser = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username))
  if (fromUser) refs.add(fromUser[1].toLowerCase())
  return [...refs]
}

/** The Supabase project(s) this repository treats as production. */
function productionProjectRefs({ env = process.env, root = process.cwd() }: PolicyContext): Set<string> {
  const refs = new Set<string>()
  for (const source of [env, readEnvFile(path.join(root, '.env.local'))]) {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'DATABASE_URL', 'DIRECT_URL']) {
      for (const ref of supabaseRefs(source[key])) refs.add(ref)
    }
  }
  return refs
}

function parse(connectionString: string | undefined, label: string): URL {
  if (!connectionString) {
    throw new Error(`Refusing to continue: ${label} is not set.`)
  }
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error(`Refusing to continue: ${label} is not a valid connection URL.`)
  }
  for (const key of url.searchParams.keys()) {
    if (HOST_OVERRIDE_PARAMS.has(key.toLowerCase())) {
      throw new Error(
        `Refusing to continue: ${label} sets the "${key}" connection parameter, which replaces the host ` +
          `this guard checks (pg, psql and Prisma all honor it, including for remote hosts and unix ` +
          `sockets). Remove it and put the host in the URL itself.`,
      )
    }
  }
  try {
    decodeURIComponent(url.hostname)
  } catch {
    throw new Error(`Refusing to continue: ${label} has a hostname with invalid percent-encoding.`)
  }
  return url
}

/**
 * Refuses only the repository's own production project. This is the floor that
 * applies to EVERY seed script, including ones deliberately allowed to seed a
 * non-production hosted environment by hand.
 */
export function assertNotProductionDatabase(
  connectionString: string | undefined,
  label: string,
  context: PolicyContext = {},
): void {
  const parsed = parse(connectionString, label)
  const prod = productionProjectRefs(context)
  const refuse = (ref: string) => {
    throw new Error(
      `Refusing to continue: ${label} points at "${ref}", this repository's production Supabase ` +
        `project (hosted Supabase production database). It can never be a test or seed target, ` +
        `and TEST_DB_ALLOW_HOST cannot permit it.`,
    )
  }
  for (const ref of supabaseRefs(connectionString)) if (prod.has(ref)) refuse(ref)
  // The ref can also ride in a query parameter (user=, options=) or the path; look for it anywhere.
  // The password is left out on purpose: it cannot identify a project and is never inspected.
  const decoded = [parsed.username, parsed.hostname, parsed.port, parsed.pathname, parsed.search, parsed.hash]
    .map(safeDecode)
    .join(' ')
    .toLowerCase()
  for (const ref of prod) if (decoded.includes(ref)) refuse(ref)
  // A component the URL lacks is filled from PG* variables, so the ref there names production too.
  const env = context.env ?? process.env
  for (const name of PRODUCTION_NAMING_ENV_VARS) {
    const value = safeDecode(env[name] ?? '').toLowerCase()
    for (const ref of prod) {
      if (value.includes(ref)) {
        throw new Error(
          `Refusing to continue: the environment variable ${name} names "${ref}", this repository's production ` +
            `Supabase project. Drivers fill whatever ${label} leaves out from it. It can never be a test or seed ` +
            `target, and TEST_DB_ALLOW_HOST cannot permit it. Unset ${name}.`,
        )
      }
    }
  }
}

/** Refuses a TEST database URL whose query string, or the environment, could send the connection elsewhere. */
function assertNoConnectionOverrides(url: URL, label: string, env: Env): void {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) {
      throw new Error(
        `Refusing to continue: ${label} carries the connection parameter "${key}", which can change the ` +
          `host, port, user or database a driver really connects to while the URL still looks local. ` +
          `Allowed parameters: ${[...ALLOWED_QUERY_PARAMS].join(', ')} (lower-case).`,
      )
    }
  }
  for (const name of REDIRECTING_ENV_VARS) {
    if ((env[name] ?? '') !== '') {
      throw new Error(
        `Refusing to continue: the environment variable ${name} is set. libpq tools (psql, createdb) apply ` +
          `it even when ${label} names localhost, so it could redirect the connection. Unset it.`,
      )
    }
  }
}

export function assertSafeTestDatabaseHost(
  connectionString: string | undefined,
  label: string,
  context: PolicyContext = {},
): void {
  const url = parse(connectionString, label)
  const host = decodedHostname(url)
  const env = context.env ?? process.env

  if (PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new Error(
      `Refusing to continue: ${label} resolves to "${host}", which looks like a hosted ` +
        `Supabase/production database. The test harness must never connect to it.`,
    )
  }

  assertNotProductionDatabase(connectionString, label, context)
  assertNoConnectionOverrides(url, label, env)

  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  const allowedCiHost = env.TEST_DB_ALLOW_HOST
  const isAllowedCiHost = Boolean(allowedCiHost) && host === allowedCiHost

  if (!isLocalhost && !isAllowedCiHost) {
    throw new Error(
      `Refusing to continue: ${label} resolves to "${host}", which is neither localhost/127.0.0.1 ` +
        `nor the host explicitly allow-listed via TEST_DB_ALLOW_HOST. Set TEST_DB_ALLOW_HOST to the ` +
        `exact CI test-database host if this is intentional.`,
    )
  }
}

/**
 * Entry guard for seed scripts, called right after dotenv has loaded .env.local (so
 * the values checked are the ones the script will actually connect with).
 *
 *   fixtureOnly  — scripts that exist only to build test data (known passwords,
 *                  synthetic users): always held to the full test-database policy.
 *   otherwise    — scripts that may be run by hand against a real non-production
 *                  environment: held to the full policy under the test harness
 *                  (TEST_HARNESS=1, set by setup-test-db.sh), and always refused
 *                  against the production project.
 */
export function assertSeedTargetIsSafe(
  script: string,
  { fixtureOnly }: { fixtureOnly: boolean },
  context: PolicyContext = {},
): void {
  const env = context.env ?? process.env
  for (const label of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    try {
      if (fixtureOnly || env.TEST_HARNESS === '1') assertSafeTestDatabaseHost(env[label], label, context)
      else assertNotProductionDatabase(env[label], label, context)
    } catch (error) {
      throw new Error(
        `${script}: ${(error as Error).message}\n` +
          `Run it through "npm run test:setup-db", or export ${label} pointing at a local Postgres first.`,
      )
    }
  }
}
