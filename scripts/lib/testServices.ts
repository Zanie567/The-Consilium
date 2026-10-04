/**
 * Isolation for everything an end-to-end run can reach besides the database
 * (scripts/lib/testDatabase.ts owns that): object storage, outbound email, OAuth,
 * cron and third-party data APIs.
 *
 * The app reads these from process.env, and `next build` / `next start` ALSO read
 * .env.local, which holds the production keys, for any variable the process did not
 * set itself. So the test stack must define every one of them explicitly - an unset
 * variable is not "off", it is "whatever production says". `isolatedServiceEnv`
 * returns the complete set and `assertIsolatedServiceEnv` refuses anything else.
 */

type Env = Record<string, string | undefined>

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

interface IsolatedServiceOptions {
  appPort: number
  storagePort: number
  distDir?: string
  /** JSONL file the app's email transport appends to instead of sending. */
  emailCaptureFile: string
}

/** Every variable the isolated stack pins. Order is irrelevant. */
export function isolatedServiceEnv(opts: IsolatedServiceOptions): Record<string, string> {
  for (const port of [opts.appPort, opts.storagePort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Test service ports must be integers between 1024 and 65535.')
    }
  }
  if (opts.appPort === opts.storagePort) throw new Error('App and storage need separate ports.')
  const appUrl = `http://localhost:${opts.appPort}`
  return {
    E2E_ISOLATED: '1',
    // Storage: a local Supabase-Storage-compatible server (tests/e2e/helpers/fake-storage-server.ts).
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${opts.storagePort}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
    SUPABASE_ANON_KEY: 'local-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
    NEXT_IMAGE_ALLOW_LOCAL_STORAGE: '1',
    // Email: captured to a file, never sent. RESEND_API_KEY is blanked on purpose.
    EMAIL_TRANSPORT: 'capture',
    EMAIL_CAPTURE_FILE: opts.emailCaptureFile,
    RESEND_API_KEY: '',
    // Auth + site URLs point at the test server; Google sign-in is switched off.
    NEXTAUTH_SECRET: 'local_e2e_secret',
    NEXTAUTH_URL: appUrl,
    NEXT_PUBLIC_SITE_URL: appUrl,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    // Cron + admin bootstrap use throwaway values, not the production secret.
    CRON_SECRET: 'local_e2e_cron_secret',
    ADMIN_EMAILS: 'admin@theconsilium.com',
    // Third-party market-data APIs: no keys, so no outbound calls on their behalf.
    TEST_MARKET_DATA: 'empty',
    FRED_API_KEY: '',
    ALPHA_VANTAGE_API_KEY: '',
    RATE_LIMIT_DISABLED: '1',
    // The build and the server must both use this directory.
    NEXT_DIST_DIR: opts.distDir ?? '.next-e2e',
  }
}

/** Throws unless `env` is fully isolated. Used by the Playwright config. */
export function assertIsolatedServiceEnv(env: Env = process.env): void {
  const problems: string[] = []

  if (env.E2E_ISOLATED !== '1') {
    problems.push('E2E_ISOLATED is not set - run through scripts/run-e2e.sh')
  }

  const storage = env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  try {
    if (!LOOPBACK.has(new URL(storage).hostname.toLowerCase())) {
      problems.push(`NEXT_PUBLIC_SUPABASE_URL is not loopback (${new URL(storage).hostname})`)
    }
  } catch {
    problems.push('NEXT_PUBLIC_SUPABASE_URL is missing or not a URL')
  }

  if (env.EMAIL_TRANSPORT !== 'capture' || !env.EMAIL_CAPTURE_FILE) {
    problems.push('EMAIL_TRANSPORT=capture with EMAIL_CAPTURE_FILE is required')
  }
  if (env.TEST_MARKET_DATA !== 'empty') problems.push('TEST_MARKET_DATA=empty is required to disable external data requests')
  if (env.RESEND_API_KEY) problems.push('RESEND_API_KEY must be empty')
  if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) problems.push('Google OAuth credentials must be empty')

  // Missing is unsafe too: Next would fill missing values from .env.local.
  for (const key of ['RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRED_API_KEY', 'ALPHA_VANTAGE_API_KEY']) {
    if (env[key] !== '') problems.push(`${key} must be explicitly empty`)
  }
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
    SUPABASE_ANON_KEY: 'local-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
    NEXTAUTH_SECRET: 'local_e2e_secret',
    CRON_SECRET: 'local_e2e_cron_secret',
  })) {
    if (env[key] !== value) problems.push(`${key} must use the isolated test value`)
  }
  if (!/^\.next-e2e(?:-[a-zA-Z0-9.-]+)?$/.test(env.NEXT_DIST_DIR ?? '')) {
    problems.push('NEXT_DIST_DIR must be a dedicated .next-e2e directory')
  }
  for (const key of ['NEXTAUTH_URL', 'NEXT_PUBLIC_SITE_URL']) {
    try {
      const url = new URL(env[key] ?? '')
      if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) throw new Error()
    } catch {
      problems.push(`${key} must be a local HTTP URL`)
    }
  }
  if (env.NEXTAUTH_URL !== env.NEXT_PUBLIC_SITE_URL) problems.push('Auth and site URLs must match')

  if (problems.length > 0) {
    throw new Error(
      'Refusing to run E2E: the environment is not isolated from production services:\n - ' +
        problems.join('\n - '),
    )
  }
}
