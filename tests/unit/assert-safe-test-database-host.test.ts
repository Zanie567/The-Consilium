/**
 * Fail-closed guard the test harness must call before any destructive setup
 * step (schema push, seed, dedupe), so a misconfigured env can never let the
 * harness silently run against a hosted/production database.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertNotProductionDatabase,
  assertSafeTestDatabaseHost,
  assertSeedTargetIsSafe,
} from '../../scripts/lib/assertSafeTestDatabaseHost'
import {
  DEFAULT_TEST_DATABASE_URL,
  resolveTestBaseUrl,
  resolveTestDatabaseUrl,
  testDatabaseEnv,
} from '../../scripts/lib/testDatabase'

afterEach(() => {
  delete process.env.TEST_DB_ALLOW_HOST
})

describe('assertSafeTestDatabaseHost', () => {
  it('allows localhost', () => {
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@localhost:5433/consilium', 'DATABASE_URL')
    ).not.toThrow()
  })

  it('allows 127.0.0.1', () => {
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@127.0.0.1:5433/consilium', 'DATABASE_URL')
    ).not.toThrow()
  })

  it('rejects an arbitrary remote host with no allow-list configured', () => {
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@db.example.com:5432/consilium', 'DATABASE_URL')
    ).toThrow(/neither localhost.*nor the host explicitly allow-listed/i)
  })

  it('allows a remote host that exactly matches TEST_DB_ALLOW_HOST', () => {
    process.env.TEST_DB_ALLOW_HOST = 'ci-postgres.internal'
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@ci-postgres.internal:5432/consilium', 'DATABASE_URL')
    ).not.toThrow()
  })

  it('rejects a Supabase pooler host even when it is not localhost', () => {
    expect(() =>
      assertSafeTestDatabaseHost(
        'postgresql://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
        'DATABASE_URL'
      )
    ).toThrow(/hosted.*Supabase.*production/i)
  })

  it('rejects a Supabase host even if someone tries to allow-list it', () => {
    process.env.TEST_DB_ALLOW_HOST = 'db.scllbuwkcqtmfogsgalt.supabase.co'
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@db.scllbuwkcqtmfogsgalt.supabase.co:5432/postgres', 'DATABASE_URL')
    ).toThrow(/hosted.*Supabase.*production/i)
  })

  it('rejects a missing connection string with a clear message naming the label', () => {
    expect(() => assertSafeTestDatabaseHost(undefined, 'DIRECT_URL')).toThrow(/DIRECT_URL is not set/)
  })

  it('rejects an unparseable connection string', () => {
    expect(() => assertSafeTestDatabaseHost('not-a-url', 'DIRECT_URL')).toThrow(/not a valid connection URL/)
  })
})

// ── The repository's own production project (ref read from env / .env.local) ─────────────

const PROD_REF = 'abcdefghijklmnopqrst'
const OTHER_REF = 'zyxwvutsrqponmlkjihg'
const PROD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  DATABASE_URL: `postgresql://postgres.${PROD_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
}
const NO_FILE = '/nonexistent-so-no-env-file'

describe('production project hard-block', () => {
  const prodDirect = `postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`

  it('refuses the production project even when its host is allow-listed', () => {
    const env = { ...PROD_ENV, TEST_DB_ALLOW_HOST: `db.${PROD_REF}.supabase.co` }
    expect(() => assertSafeTestDatabaseHost(prodDirect, 'X', { env, root: NO_FILE })).toThrow(/hosted.*Supabase.*production/i)
  })

  it('refuses it when reached through a non-Supabase host, via the pooler-style username', () => {
    const env = { ...PROD_ENV, TEST_DB_ALLOW_HOST: 'proxy.internal' }
    expect(() =>
      assertSafeTestDatabaseHost(`postgresql://postgres.${PROD_REF}:pw@proxy.internal:5432/postgres`, 'X', { env, root: NO_FILE }),
    ).toThrow(/production Supabase project/)
  })

  it('reads the production ref from .env.local too, not only the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'))
    writeFileSync(join(dir, '.env.local'), `DIRECT_URL="postgresql://postgres.${PROD_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"\n`)
    const env = { TEST_DB_ALLOW_HOST: 'proxy.internal' }
    expect(() =>
      assertNotProductionDatabase(`postgresql://postgres.${PROD_REF}:pw@proxy.internal:5432/postgres`, 'X', { env, root: dir }),
    ).toThrow(/production Supabase project/)
  })

  it('still refuses ANY hosted Supabase project, not just the production one', () => {
    expect(() =>
      assertSafeTestDatabaseHost(`postgresql://postgres:pw@db.${OTHER_REF}.supabase.co:5432/postgres`, 'X', { env: PROD_ENV, root: NO_FILE }),
    ).toThrow(/hosted.*Supabase/i)
  })
})

// ── Connection-string parameters that change where the driver actually connects ─────────
//
// The checks above read URL.hostname, but pg, psql (libpq) and Prisma's schema engine all let a
// `host` query parameter replace it (a hostname, or a unix-socket directory), and libpq also honors
// `hostaddr` and `service`. `postgresql://localhost/db?host=db.<prod-ref>.supabase.co` therefore
// passed every check and connected to the remote database. These pin that it can no longer.

describe('host overrides in the connection string', () => {
  const REMOTE = 'remote.example.com'
  const withParam = (param: string, base = 'postgresql://postgres@localhost:5433/consilium') => `${base}?${param}`
  const overrides: Array<[string, string]> = [
    ['a remote hostname', `host=${REMOTE}`],
    ['a unix-socket directory', 'host=/var/run/postgresql'],
    ['an encoded unix-socket directory', 'host=%2Fvar%2Frun%2Fpostgresql'],
    ['a numeric hostaddr', 'hostaddr=203.0.113.9'],
    ['the production database host', `host=db.${PROD_REF}.supabase.co`],
    ['a libpq service definition', 'service=prod'],
    ['an upper-case key', `HOST=${REMOTE}`],
    ['a mixed-case key', `HostAddr=203.0.113.9`],
    ['an override after harmless parameters', `connect_timeout=5&sslmode=disable&host=${REMOTE}`],
    ['a repeated key', `host=localhost&host=${REMOTE}`],
    ['an empty value', 'host='],
  ]

  it.each(overrides)('assertSafeTestDatabaseHost refuses %s', (_label, param) => {
    expect(() => assertSafeTestDatabaseHost(withParam(param), 'X', { env: {}, root: NO_FILE })).toThrow(/host|hostaddr|service/i)
  })

  it.each(overrides)('assertNotProductionDatabase refuses %s too (it guards hand-run seeds)', (_label, param) => {
    expect(() => assertNotProductionDatabase(withParam(param), 'X', { env: PROD_ENV, root: NO_FILE })).toThrow(/host|hostaddr|service/i)
  })

  it('refuses an override that smuggles in the production project, however the guard is reached', () => {
    const url = withParam(`host=db.${PROD_REF}.supabase.co`)
    expect(() => assertSafeTestDatabaseHost(url, 'X', { env: PROD_ENV, root: NO_FILE })).toThrow()
    expect(() => assertNotProductionDatabase(url, 'X', { env: PROD_ENV, root: NO_FILE })).toThrow()
    expect(() => resolveTestDatabaseUrl({ ...PROD_ENV, TEST_DATABASE_URL: url }, NO_FILE)).toThrow()
  })

  it('names the offending parameter and says why', () => {
    expect(() => assertSafeTestDatabaseHost(withParam(`host=${REMOTE}`), 'TEST_DATABASE_URL', { env: {}, root: NO_FILE })).toThrow(
      /TEST_DATABASE_URL[\s\S]*"host"[\s\S]*(replace|override)/i,
    )
  })

  it('is not undone by TEST_DB_ALLOW_HOST, even when it names the override target', () => {
    const env = { TEST_DB_ALLOW_HOST: REMOTE }
    expect(() => assertSafeTestDatabaseHost(withParam(`host=${REMOTE}`), 'X', { env, root: NO_FILE })).toThrow()
    expect(() => assertSafeTestDatabaseHost(withParam('host=localhost'), 'X', { env, root: NO_FILE })).toThrow()
  })

  it('stops every seed entry point, for DATABASE_URL and for DIRECT_URL', () => {
    const local = 'postgresql://postgres@localhost:5433/consilium'
    const bad = withParam(`host=${REMOTE}`)
    for (const fixtureOnly of [true, false]) {
      for (const env of [
        { DATABASE_URL: bad, DIRECT_URL: local },
        { DATABASE_URL: local, DIRECT_URL: bad },
        { DATABASE_URL: bad, DIRECT_URL: local, TEST_HARNESS: '1' },
      ]) {
        expect(() => assertSeedTargetIsSafe('s', { fixtureOnly }, { env, root: NO_FILE }), JSON.stringify([fixtureOnly, env])).toThrow(/Run it through/)
      }
    }
  })

  it('stops the test database resolution that vitest.config.ts and the Prisma config rely on', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: withParam(`host=${REMOTE}`) }, NO_FILE)).toThrow()
    expect(() => testDatabaseEnv({ TEST_DATABASE_URL: withParam('host=/tmp') }, NO_FILE)).toThrow()
  })

  it('still accepts ordinary local URLs and their harmless parameters', () => {
    for (const url of [
      'postgresql://postgres@localhost:5433/consilium',
      'postgresql://postgres@127.0.0.1:5433/consilium',
      'postgresql://postgres@[::1]:5433/consilium',
      'postgresql://user:pass@localhost:5432/db?schema=public',
      'postgresql://postgres@localhost:5433/consilium?connect_timeout=5&sslmode=disable&application_name=tests',
    ]) {
      expect(() => assertSafeTestDatabaseHost(url, 'X', { env: {}, root: NO_FILE }), url).not.toThrow()
    }
  })

  it('still accepts the explicitly allow-listed CI host (no override in the URL)', () => {
    const url = 'postgresql://postgres:postgres@ci-postgres.internal:5432/consilium?connect_timeout=5'
    expect(() => assertSafeTestDatabaseHost(url, 'X', { env: { TEST_DB_ALLOW_HOST: 'ci-postgres.internal' }, root: NO_FILE })).not.toThrow()
  })
})

describe('other connection-string spellings of a remote or production host', () => {
  const check = (url: string, env: Record<string, string> = PROD_ENV) => assertSafeTestDatabaseHost(url, 'X', { env, root: NO_FILE })

  // The URL parser leaves %XX in a non-special-scheme hostname, but every driver decodes it, so
  // db.%61bc….supabase.co reaches the real project while evading a ref match on the raw string.
  it('sees through a percent-encoded production host (the driver decodes it)', () => {
    const encodedRef = `db.%61${PROD_REF.slice(1)}.supabase.co`
    expect(() => assertNotProductionDatabase(`postgresql://postgres:pw@${encodedRef}:5432/postgres`, 'X', { env: PROD_ENV, root: NO_FILE })).toThrow(/production Supabase project/)
    // assertSafeTestDatabaseHost refuses any decoded *.supabase.co host first (rule 1), then the project (rule 2).
    expect(() => check(`postgresql://postgres:pw@${encodedRef}:5432/postgres`)).toThrow(/hosted.*Supabase/i)
  })

  it('sees through a percent-encoded hosted-Supabase top level domain', () => {
    expect(() => check(`postgresql://postgres:pw@db.${OTHER_REF}.supabase.%63o:5432/postgres`)).toThrow(/hosted.*Supabase/i)
  })

  it('treats an unparseable percent-escape as unsafe rather than skipping the check', () => {
    expect(() => check('postgresql://postgres@%E0%A4%A:5432/consilium')).toThrow()
    expect(() => assertNotProductionDatabase('postgresql://postgres@%E0%A4%A:5432/consilium', 'X', { env: PROD_ENV, root: NO_FILE })).toThrow()
  })

  it('keeps refusing multi-host URLs, host-in-userinfo tricks and an empty host', () => {
    for (const url of [
      'postgresql://localhost:5433,remote.example.com:5432/consilium',
      'postgresql://localhost,remote.example.com/consilium',
      'postgresql://localhost@remote.example.com/consilium',
      'postgresql:///consilium',
    ]) {
      expect(() => check(url, {}), url).toThrow()
    }
  })
})

// ── Connection parameters that make the driver connect somewhere the hostname does not say ────────
//
// Found by testing the drivers, not by reading the guard: `pg` and libpq both let the query string
// override the URL's host, so "localhost" in the URL did not mean localhost on the wire.

describe('connection-string overrides cannot bypass the guard', () => {
  const LOCAL = 'postgresql://postgres@localhost:5433/consilium_sched_e2e'

  it.each([
    ['host', `${LOCAL}?host=db.example.org`],
    ['host (unix socket path)', `${LOCAL}?host=%2Fvar%2Frun%2Fpostgresql`],
    ['hostaddr', `${LOCAL}?hostaddr=203.0.113.9`],
    ['dbname (defeats the database-name guards)', `${LOCAL}?dbname=production`],
    ['user', `${LOCAL}?user=postgres.abcdefghijklmnopqrst`],
    ['port', `${LOCAL}?port=6543`],
    ['service', `${LOCAL}?service=prod`],
    ['servicefile', `${LOCAL}?servicefile=/tmp/pg_service.conf`],
    ['options', `${LOCAL}?options=-c%20search_path%3Dprivate`],
    ['target_session_attrs', `${LOCAL}?target_session_attrs=read-write`],
    ['an upper-case spelling', `${LOCAL}?HOST=db.example.org`],
    ['a percent-encoded key', `${LOCAL}?%68ost=db.example.org`],
    ['an override hidden after allowed parameters', `${LOCAL}?schema=public&sslmode=disable&hostaddr=203.0.113.9`],
    ['a repeated key', `${LOCAL}?host=localhost&host=db.example.org`],
    ['an unknown parameter', `${LOCAL}?anything=1`],
  ])('refuses %s', (_name, url) => {
    expect(() => assertSafeTestDatabaseHost(url, 'TEST_DATABASE_URL')).toThrow(/connection parameter/i)
  })

  it('refuses them even for a host the CI explicitly allow-listed', () => {
    process.env.TEST_DB_ALLOW_HOST = 'ci-postgres.internal'
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@ci-postgres.internal:5432/consilium?hostaddr=203.0.113.9', 'TEST_DATABASE_URL'),
    ).toThrow(/connection parameter/i)
  })

  it('still accepts the parameters this repository really uses', () => {
    for (const q of ['?schema=public', '?sslmode=disable', '?pgbouncer=true&connection_limit=1', '?schema=public&sslmode=disable']) {
      expect(() => assertSafeTestDatabaseHost(`${LOCAL}${q}`, 'TEST_DATABASE_URL')).not.toThrow()
    }
  })

  it('refuses other ways of naming more than one or a different host', () => {
    for (const url of [
      'postgresql://localhost,db.example.org/consilium_sched_e2e', // multi-host
      'postgresql:///consilium_sched_e2e', // no host: the driver would fall back to PGHOST
      'postgresql://postgres@localhost@db.example.org/consilium_sched_e2e', // userinfo trick
    ]) {
      expect(() => assertSafeTestDatabaseHost(url, 'TEST_DATABASE_URL'), url).toThrow()
    }
  })

  it('judges the host drivers actually connect to: an encoded localhost IS localhost, an encoded remote host is not', () => {
    // drivers decode %XX in the hostname (pg, libpq, Prisma), so the guard decodes it too
    expect(() => assertSafeTestDatabaseHost('postgresql://postgres@%6Cocalhost/consilium_sched_e2e', 'TEST_DATABASE_URL')).not.toThrow()
    expect(() => assertSafeTestDatabaseHost('postgresql://postgres@db%2Eexample%2Eorg/consilium_sched_e2e', 'TEST_DATABASE_URL')).toThrow()
  })

  it.each(['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE'])('refuses to run while %s is set (libpq applies it even to a localhost URL)', (name) => {
    expect(() => assertSafeTestDatabaseHost(LOCAL, 'TEST_DATABASE_URL', { env: { [name]: 'x' } })).toThrow(new RegExp(name))
    // an empty value is "not set"
    expect(() => assertSafeTestDatabaseHost(LOCAL, 'TEST_DATABASE_URL', { env: { [name]: '' } })).not.toThrow()
  })

  it('does not name the offending value in the message (it may be a credential)', () => {
    try {
      assertSafeTestDatabaseHost(`${LOCAL}?hostaddr=203.0.113.9`, 'TEST_DATABASE_URL')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain('203.0.113.9')
    }
  })
})

// ── Production-project identification must not depend on where the ref appears ──────────────
// The ref can ride in the username (pooler tenant), the host, or a query parameter (user=,
// options=), percent-encoded or not. Any appearance of the known production ref is a refusal.

describe('production project is recognised wherever its ref appears in the URL', () => {
  const prod = (url: string) => assertNotProductionDatabase(url, 'X', { env: PROD_ENV, root: NO_FILE })

  it.each([
    ['user= query parameter', `postgresql://nobody:pw@proxy.internal:5432/postgres?user=postgres.${PROD_REF}`],
    ['percent-encoded user= value', `postgresql://nobody:pw@proxy.internal:5432/postgres?user=postgres%2E${PROD_REF}`],
    ['options= tenant hint', `postgresql://postgres:pw@pooler.example.net:6543/postgres?options=project%3D${PROD_REF}`],
    ['database path', `postgresql://postgres:pw@proxy.internal:5432/${PROD_REF}`],
    ['percent-encoded username', `postgresql://postgres%2E${PROD_REF}:pw@proxy.internal:5432/postgres`],
    ['upper-case ref', `postgresql://postgres.${PROD_REF.toUpperCase()}:pw@proxy.internal:5432/postgres`],
    ['partly percent-encoded ref', `postgresql://postgres:pw@proxy.internal:5432/postgres?x=%61${PROD_REF.slice(1)}`],
  ])('refuses it in the %s', (_name, url) => {
    expect(() => prod(url)).toThrow(/production Supabase project/)
  })

  it('still lets an unrelated hosted environment through the hand-run seed check', () => {
    expect(() => prod(`postgresql://postgres.${OTHER_REF}:pw@pooler.example.net:6543/postgres?pgbouncer=true&sslmode=require`)).not.toThrow()
  })

  it('does not choke on a raw % in a password (decoding must not make the check throw or skip)', () => {
    expect(() => prod(`postgresql://postgres:50%off@proxy.internal:5432/postgres?user=postgres.${PROD_REF}`)).toThrow(/production Supabase project/)
    expect(() => prod('postgresql://postgres:50%off@proxy.internal:5432/postgres')).not.toThrow()
  })
})

// ── Production project named only through PG* environment variables ───────────────────────────
// node-postgres (which the hand-run seeds use through PrismaPg) fills any component the URL lacks
// from PGHOST / PGUSER / PGDATABASE / PGOPTIONS, so `postgresql:///postgres` with PGHOST=db.<ref>…
// or a pooler URL with no username plus PGUSER=postgres.<ref> reaches production while the URL
// itself carries no ref. The ref in those variables counts as the connection string naming it.

describe('production project named through PG* environment variables', () => {
  const URLS = ['postgresql:///postgres', 'postgresql://aws-0-eu-west-1.pooler.supabase.com:6543/postgres']
  const withPg = (pg: Record<string, string>) => ({ ...PROD_ENV, ...pg })

  it.each([
    ['PGHOST', `db.${PROD_REF}.supabase.co`],
    ['PGUSER', `postgres.${PROD_REF}`],
    ['PGDATABASE', PROD_REF],
    ['PGOPTIONS', `project=${PROD_REF}`],
    ['PGSERVICE', PROD_REF],
    ['PGUSER', `postgres.${PROD_REF.toUpperCase()}`],
    ['PGUSER', `postgres%2E${PROD_REF}`],
  ])('refuses %s=%s', (name, value) => {
    const env = withPg({ [name]: value })
    for (const url of URLS) {
      expect(() => assertNotProductionDatabase(url, 'DIRECT_URL', { env, root: NO_FILE }), `${name} ${url}`).toThrow(new RegExp(`${name}.*production Supabase project`, 's'))
      expect(
        () => assertSeedTargetIsSafe('prisma/seed.ts', { fixtureOnly: false }, { env: { ...env, DATABASE_URL: url, DIRECT_URL: url }, root: NO_FILE }),
        `seed ${name} ${url}`,
      ).toThrow(/Run it through/)
    }
  })

  it('names the variable but never echoes its value', () => {
    try {
      assertNotProductionDatabase(URLS[1], 'DIRECT_URL', { env: withPg({ PGUSER: `postgres.${PROD_REF}.s3cret-suffix` }), root: NO_FILE })
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as Error).message).toMatch(/PGUSER/)
      expect((error as Error).message).not.toContain('s3cret-suffix')
    }
  })

  it('ignores unrelated PG* values, and never inspects PGPASSWORD', () => {
    const env = withPg({ PGHOST: 'localhost', PGUSER: 'postgres', PGDATABASE: 'consilium', PGPASSWORD: `${PROD_REF}-looks-like-a-ref`, PGSSLMODE: 'disable' })
    for (const url of URLS) expect(() => assertNotProductionDatabase(url, 'DIRECT_URL', { env, root: NO_FILE })).not.toThrow()
  })

  it('never inspects a password, in the URL or the environment', () => {
    // A password cannot identify a project; scanning it would only risk refusing (and so hinting at) a secret.
    const url = `postgresql://postgres:${PROD_REF}-not-a-ref@staging.example.com:5432/consilium`
    expect(() => assertNotProductionDatabase(url, 'DIRECT_URL', { env: PROD_ENV, root: NO_FILE })).not.toThrow()
    expect(() =>
      assertNotProductionDatabase(`postgresql://postgres:${PROD_REF}@proxy.internal:5432/postgres?user=postgres.${PROD_REF}`, 'X', { env: PROD_ENV, root: NO_FILE }),
    ).toThrow(/production Supabase project/) // still refused, but because of user=, not the password
  })

  it('does not affect a hand-run seed against a real non-production environment', () => {
    const url = 'postgresql://postgres@staging.example.com:5432/consilium?pgbouncer=true'
    const env = { NEXT_PUBLIC_SUPABASE_URL: PROD_ENV.NEXT_PUBLIC_SUPABASE_URL, PGHOST: 'staging.example.com', PGUSER: 'postgres', DATABASE_URL: url, DIRECT_URL: url }
    expect(() => assertSeedTargetIsSafe('prisma/seed.ts', { fixtureOnly: false }, { env, root: NO_FILE })).not.toThrow()
  })
})

describe('assertSeedTargetIsSafe', () => {
  const local = 'postgresql://postgres@localhost:5433/consilium'
  const remote = 'postgresql://postgres@staging.example.com:5432/consilium'
  const prod = PROD_ENV.DATABASE_URL
  const run = (env: Record<string, string>, fixtureOnly: boolean) =>
    assertSeedTargetIsSafe('prisma/seed.ts', { fixtureOnly }, { env: { ...PROD_ENV, ...env }, root: NO_FILE })

  it('fixture seeds accept only a test database', () => {
    expect(() => run({ DATABASE_URL: local, DIRECT_URL: local }, true)).not.toThrow()
    expect(() => run({ DATABASE_URL: local, DIRECT_URL: remote }, true)).toThrow(/Run it through/)
    expect(() => run({ DATABASE_URL: prod, DIRECT_URL: local }, true)).toThrow()
  })

  it('other seeds may target a real non-production environment by hand…', () => {
    expect(() => run({ DATABASE_URL: remote, DIRECT_URL: remote }, false)).not.toThrow()
  })

  it('…but never the production project, and never a remote host under the test harness', () => {
    expect(() => run({ DATABASE_URL: prod, DIRECT_URL: prod }, false)).toThrow()
    expect(() => run({ DATABASE_URL: local, DIRECT_URL: prodDirectFor() }, false)).toThrow()
    expect(() => run({ DATABASE_URL: remote, DIRECT_URL: remote, TEST_HARNESS: '1' }, false)).toThrow(/neither localhost/)
  })

  it('fails closed when a connection string is missing', () => {
    expect(() => assertSeedTargetIsSafe('s', { fixtureOnly: true }, { env: { DATABASE_URL: local }, root: NO_FILE })).toThrow(/DIRECT_URL is not set/)
  })

  function prodDirectFor() {
    return `postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`
  }
})

// ── Which database tests use ─────────────────────────────────────────────────────────────

describe('test database resolution (TEST_DATABASE_URL is the source of truth)', () => {
  it('ignores a hostile DATABASE_URL / DIRECT_URL and overwrites them with the verified URL', () => {
    const hostile = { ...PROD_ENV, DIRECT_URL: PROD_ENV.DATABASE_URL }
    const env = testDatabaseEnv(hostile, NO_FILE)
    expect(env.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL)
    expect(env.DIRECT_URL).toBe(DEFAULT_TEST_DATABASE_URL)
    expect(new URL(env.DATABASE_URL).hostname).toBe('localhost')
  })

  it('uses TEST_DATABASE_URL when it is safe, and throws when it is not', () => {
    const mine = 'postgresql://postgres@127.0.0.1:5999/mine'
    expect(resolveTestDatabaseUrl({ ...PROD_ENV, TEST_DATABASE_URL: mine }, NO_FILE)).toBe(mine)
    expect(() => resolveTestDatabaseUrl({ ...PROD_ENV, TEST_DATABASE_URL: PROD_ENV.DATABASE_URL }, NO_FILE)).toThrow()
  })

  it('accepts a remote CI database only through TEST_DB_ALLOW_HOST', () => {
    const url = 'postgresql://postgres@ci-postgres.internal:5432/consilium'
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: url }, NO_FILE)).toThrow(/neither localhost/)
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: url, TEST_DB_ALLOW_HOST: 'ci-postgres.internal' }, NO_FILE)).toBe(url)
  })

  it('this very run is wired to a safe database even though .env.local points at production', async () => {
    const { config } = await import('dotenv')
    const { resolve } = await import('node:path')
    config({ path: resolve(__dirname, '../../.env.local') }) // what the legacy integration tests do at import
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL']) {
      expect(process.env[key], key).toBeTruthy()
      expect(() => assertSafeTestDatabaseHost(process.env[key], key)).not.toThrow()
      expect(new URL(process.env[key]!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/)
    }
  })
})

describe('resolveTestBaseUrl', () => {
  it('only allows a local server unless the exact host is opted in', () => {
    expect(resolveTestBaseUrl(undefined, {})).toBe('http://localhost:3000')
    expect(resolveTestBaseUrl('http://127.0.0.1:3100', {})).toBe('http://127.0.0.1:3100')
    expect(() => resolveTestBaseUrl('https://www.theconsilium.co.uk', {})).toThrow(/remote site/)
    expect(() => resolveTestBaseUrl('https://www.theconsilium.co.uk', { TEST_BASE_URL_ALLOW_HOST: 'www.theconsilium.co.uk' })).not.toThrow()
  })
})
