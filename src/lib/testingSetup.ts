/**
 * What is missing before Testing Mode may run, as a checklist an administrator can act on.
 *
 * This does NOT decide anything. `testingConfigurationError` (testingMode.ts) is the one guard
 * that refuses to start testing; `ready` here is derived from it, so this page can never report
 * "ready" while the guard says no. The per-requirement rows only explain which requirement the
 * guard would trip over. They name variables, never print values, so no secret can leak into the
 * page.
 */
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { hostedTestingConfigurationError } from '@/lib/hostedTestingWorkspace'
import { testingConfigurationError } from '@/lib/testingMode'

type Env = Record<string, string | undefined>

export interface SetupCheck {
  id: string
  label: string
  ok: boolean
  /** What to do when it is not satisfied. Variable names only. */
  hint: string
}

export interface SetupStatus {
  /** True only when the enforcing guard itself accepts this environment. */
  ready: boolean
  kind: 'local' | 'hosted' | 'invalid'
  checks: SetupCheck[]
  /** The guard's own message, verbatim, for the first thing it refuses. */
  guardMessage: string | null
}

const isLoopback = (value?: string) => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value ?? '').hostname) } catch { return false }
}
const PROVIDER_KEYS = ['RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRED_API_KEY', 'ALPHA_VANTAGE_API_KEY'] as const

export function testingSetupStatus(env: Env = process.env): SetupStatus {
  const guardMessage = testingConfigurationError(env)
  const kindRaw = env.TESTING_WORKSPACE_KIND
  const kind: SetupStatus['kind'] = kindRaw === 'hosted' ? 'hosted' : !kindRaw || kindRaw === 'local' ? 'local' : 'invalid'
  const enabled = env.TESTING_MODE_ENABLED === '1'

  const checks: SetupCheck[] = [
    {
      id: 'enabled',
      label: 'Testing mode is switched on for this deployment',
      ok: enabled,
      hint: 'Set TESTING_MODE_ENABLED=1, only on a deployment that is isolated from the live site (see below).',
    },
    {
      id: 'kind',
      label: 'The workspace kind is recognised',
      ok: kind !== 'invalid',
      hint: 'TESTING_WORKSPACE_KIND must be empty or "local" for a local workspace, or "hosted" for the reviewed hosted one.',
    },
  ]

  if (kind === 'hosted') {
    const hosted = hostedTestingConfigurationError(env)
    checks.push({
      id: 'hosted',
      label: 'The hosted configuration matches the reviewed testing project exactly',
      ok: hosted === null,
      hint: 'The database, storage, site origins, email capture and the identifiers of the reviewed project must all match. See the hosted operator setup.',
    })
  } else {
    let databaseOk = false
    if (env.TEST_DATABASE_URL && env.DATABASE_URL === env.TEST_DATABASE_URL && env.DIRECT_URL === env.TEST_DATABASE_URL) {
      try { assertSafeTestDatabaseHost(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL', { env }); databaseOk = true } catch { databaseOk = false }
    }
    checks.push(
      {
        id: 'database',
        label: 'A disposable local test database is the only database in use',
        ok: databaseOk,
        hint: 'Set TEST_DATABASE_URL to a local Postgres and use it for DATABASE_URL and DIRECT_URL too. Hosts other than this machine are refused.',
      },
      {
        id: 'services',
        label: 'The app, site and storage all run on this machine',
        ok: isLoopback(env.NEXT_PUBLIC_SUPABASE_URL) && isLoopback(env.NEXTAUTH_URL) && isLoopback(env.NEXT_PUBLIC_SITE_URL),
        hint: 'NEXT_PUBLIC_SUPABASE_URL, NEXTAUTH_URL and NEXT_PUBLIC_SITE_URL must be localhost addresses.',
      },
      {
        id: 'email',
        label: 'Email is captured to a file and every outside integration is off',
        ok: env.EMAIL_TRANSPORT === 'capture' && Boolean(env.EMAIL_CAPTURE_FILE) && PROVIDER_KEYS.every((k) => !env[k]),
        hint: 'Set EMAIL_TRANSPORT=capture with EMAIL_CAPTURE_FILE, and leave RESEND_API_KEY, Google OAuth, FRED and Alpha Vantage keys unset.',
      },
      {
        id: 'identity',
        label: 'The workspace has an identity',
        ok: Boolean(env.TESTING_WORKSPACE_ID),
        hint: 'Set TESTING_WORKSPACE_ID. The seed script writes the matching marker into the test database.',
      },
    )
  }

  // The checklist can only say "ready" when the guard itself agrees.
  return { ready: guardMessage === null, kind, checks, guardMessage }
}

/** Plain-language reason the live site shows "unavailable", for people who are not looking at env files. */
export const WHY_UNAVAILABLE =
  'Testing Mode signs in as dedicated test accounts and writes real data (articles, profiles, notifications). ' +
  'It therefore refuses to run anywhere that is not a verified, disposable workspace, and the live site is deliberately never one of them. ' +
  'This is a safety rule, not a fault.'

export const SETUP_STEPS_LOCAL = [
  'Install PostgreSQL 16 and run `npm install`.',
  'Create a disposable database: `PGPORT=55435 PGDATA=/tmp/consilium-testing-pg npm run test:setup-db`.',
  'Start the isolated workspace: `TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm run testing:workspace`. The launcher sets every variable above for you, builds the app and serves it on localhost.',
  'Open `/admin/testing` on that localhost address and sign in as the seeded test administrator (see docs/testing/appointments-and-testing-mode.md).',
] as const
