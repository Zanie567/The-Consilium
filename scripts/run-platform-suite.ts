/** Shared CI/local sequencing. Always invoke through platform-check.ts. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { testDatabaseEnv } from './lib/testDatabase'

const mode = process.argv[2]
if (!['integration', 'browser', 'all'].includes(mode)) throw new Error('Expected integration, browser or all.')
Object.assign(process.env, testDatabaseEnv())
if (process.env.TEST_HARNESS !== '1' || !process.env.BASE_URL || !process.env.FAKE_STORAGE_PORT) {
  throw new Error('Run through scripts/platform-check.ts.')
}
const app = new URL(process.env.BASE_URL)
const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
if (app.hostname !== 'localhost' || storage.hostname !== '127.0.0.1') throw new Error('Local services required.')
const logs = mkdtempSync(join(tmpdir(), 'consilium-suite-'))
const services: ChildProcess[] = []
let activeCommand: ChildProcess | undefined
let serviceFailure: Error | undefined
let cleaning = false

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (serviceFailure) return reject(serviceFailure)
    const child = spawn(command, args, { stdio: 'inherit', detached: true })
    activeCommand = child
    child.on('error', reject)
    child.on('exit', (code) => {
      activeCommand = undefined
      if (serviceFailure) reject(serviceFailure)
      else if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function freePort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(port, () => probe.close(() => resolve()))
  })
}

function service(command: string, args: string[], name: string) {
  const output = createWriteStream(join(logs, `${name}.log`))
  const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  services.push(child)
  child.stdout!.pipe(output)
  child.stderr!.pipe(output)
  child.on('error', (error) => { console.error(error); child.kill() })
  child.on('exit', (code, signal) => {
    if (cleaning) return
    serviceFailure = new Error(`${name} exited unexpectedly (${code ?? signal}).`)
    if (activeCommand) stop(activeCommand)
  })
  return child
}

async function ready(child: ChildProcess, url: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error(`Service exited before ready: ${url}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.status === 200 && Array.isArray(await response.json())) return
    } catch { /* A bounded startup probe; failure after the deadline is fatal. */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Service never became ready: ${url}`)
}

function stop(child: ChildProcess) {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) {
      // A child can exit between checking exitCode and sending the signal.
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
    }
  }
}
function cleanup() {
  cleaning = true
  if (activeCommand) stop(activeCommand)
  for (const child of services) stop(child)
}
process.on('SIGTERM', () => { cleanup(); process.exit(1) })
process.on('SIGINT', () => { cleanup(); process.exit(1) })

async function main() {
  console.log(`Service logs: ${logs}`)
  await freePort(Number(app.port))
  await freePort(Number(storage.port))
  await run('npm', ['run', 'test:setup-db'])
  await run('psql', [process.env.TEST_DATABASE_URL!, '-v', 'ON_ERROR_STOP=1', '-f', 'tests/e2e/helpers/local-storage-schema.sql', '-f', 'supabase/migrations/20261001_team_member_user_link.sql'])
  await run('npm', ['run', 'build'])
  const store = service('npx', ['ts-node', '-P', 'tsconfig.seed.json', 'tests/e2e/helpers/fake-storage-server.ts'], 'storage')
  await ready(store, `${storage.origin}/__objects`)
  const server = service('npm', ['run', 'start', '--', '-p', app.port], 'app')
  await ready(server, `${app.origin}/api/articles`)
  if (mode !== 'browser') await run('npm', ['run', 'test:integration'])
  if (mode === 'all') await run('npm', ['test'])
  if (mode !== 'integration') {
    process.env.E2E_TEAM_PROFILE = '1'
    await run('npx', ['playwright', 'test', '--workers=1'])
  }
}
main().catch((error) => {
  console.error(error)
  for (const name of ['app', 'storage']) {
    try { console.error(readFileSync(join(logs, `${name}.log`), 'utf8').split('\n').slice(-60).join('\n')) } catch (readError) {
      if (!(readError instanceof Error && 'code' in readError && readError.code === 'ENOENT')) throw readError
    }
  }
  process.exitCode = 1
}).finally(cleanup)
