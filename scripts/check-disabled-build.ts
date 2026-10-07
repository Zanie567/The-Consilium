/** Production compilation with simulation disabled, without production service fallback. */
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { testDatabaseEnv } from './lib/testDatabase'
import { isolatedServiceEnv, assertIsolatedServiceEnv } from './lib/testServices'

const distDir = `.next-e2e-disabled-${process.pid}`
const evidence = `test-results/disabled-build-${process.pid}`
const services = isolatedServiceEnv({
  appPort: 3344, storagePort: 55427, distDir,
  emailCaptureFile: '/tmp/consilium-disabled-build-mail.jsonl',
})
assertIsolatedServiceEnv(services)
const env = { ...process.env, ...testDatabaseEnv(), ...services, TESTING_MODE_ENABLED: '0' }
fs.mkdirSync(evidence, { recursive: true })
fs.copyFileSync('tsconfig.json', `${distDir}.tsconfig.json`)
const log = fs.openSync(`${evidence}/build.log`, 'w')
const result = spawnSync('npm', ['run', 'build'], { env, stdio: ['ignore', log, log] })
fs.closeSync(log)
console.log(`Testing-disabled production build: ${result.status === 0 ? 'PASS' : 'FAIL'}; ${evidence}/build.log`)
process.exitCode = result.status ?? 1
