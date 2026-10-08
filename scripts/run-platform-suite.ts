/** Upgrade entry point backed by the newer attested, disposable test stack. */
import { spawn } from 'node:child_process'
import { testDatabaseEnv } from './lib/testDatabase'

const mode = process.argv[2]
if (!['integration', 'browser', 'all'].includes(mode)) throw new Error('Expected integration, browser or all.')
const database = testDatabaseEnv()
const child = spawn('bash', ['scripts/run-e2e.sh'], {
  stdio: 'inherit',
  env: {
    ...process.env, ...database,
    E2E_APP_PORT: process.env.PLATFORM_TEST_PORT ?? '3220',
    FAKE_STORAGE_PORT: process.env.PLATFORM_TEST_STORAGE_PORT ?? '55620',
    RUN_VITEST: mode === 'browser' ? '0' : '1',
    E2E_VITEST_SUITE: mode === 'integration' ? 'integration' : 'all',
    E2E_VITEST_ONLY: mode === 'integration' ? '1' : '0',
  },
})
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal))
