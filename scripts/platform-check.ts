/** Run a local upgrade check with the existing DB guards and no external credentials.
 * Usage: npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run build
 * TEST_DATABASE_URL chooses the guarded DB. PLATFORM_TEST_PORT / _STORAGE_PORT
 * select loopback services. Use the same values for build, server and tests.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { testDatabaseEnv } from './lib/testDatabase'

function port(value: string | undefined, fallback: number, label: string): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`${label} must be an integer from 1024 to 65535.`)
  }
  return parsed
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command) throw new Error('Supply a command to run against local test services.')

  // Verify BEFORE clearing inherited variables: the policy still sees the actual
  // production project references, including .env.local and any CI environment.
  const database = testDatabaseEnv()
  const appPort = port(process.env.PLATFORM_TEST_PORT, 3197, 'PLATFORM_TEST_PORT')
  const storagePort = port(process.env.PLATFORM_TEST_STORAGE_PORT, 55491, 'PLATFORM_TEST_STORAGE_PORT')
  if (appPort === storagePort) throw new Error('App and storage ports must differ.')
  const env = { ...process.env }
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local']) {
    let source: string
    try {
      source = readFileSync(resolve(process.cwd(), name), 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    // Empty values prevent Next/dotenv falling back to credentials in env files.
    for (const key of Object.keys(parse(source))) env[key] = ''
  }
  Object.assign(env, database, {
    TEST_HARNESS: '1',
    NEXTAUTH_SECRET: 'platform-upgrade-local-tests-only',
    NEXTAUTH_URL: `http://localhost:${appPort}`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${appPort}`,
    BASE_URL: `http://localhost:${appPort}`,
    E2E_BASE_URL: `http://localhost:${appPort}`,
    E2E_PORT: String(appPort),
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${storagePort}`,
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-key',
    SUPABASE_ANON_KEY: 'local-test-key',
    NEXT_IMAGE_ALLOW_LOCAL_STORAGE: '1',
    FAKE_STORAGE_PORT: String(storagePort),
    RESEND_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    FRED_API_KEY: '',
    ADMIN_EMAILS: '',
    CRON_SECRET: 'platform-upgrade-local-cron-tests-only',
    RATE_LIMIT_DISABLED: '1',
    AUDIT_NO_RATE_LIMIT: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  })
  console.warn(`[platform-check] guarded test DB; app localhost:${appPort}; storage loopback:${storagePort}; email/OAuth disabled`)
  const child = spawn(command, args, { env, stdio: 'inherit', shell: false })
  child.on('error', (error) => {
    console.error(`[platform-check] command failed to start: ${error.message}`)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { child.kill(signal) })
  }
}

try {
  main()
} catch (error) {
  console.error(`[platform-check] ${error instanceof Error ? error.message : 'Refusing unsafe test setup.'}`)
  process.exitCode = 1
}
