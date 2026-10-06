/** Hold a database-scoped lease for a browser/interactive run; never reuse another run's fixtures. */
import { Client } from 'pg'
import { writeFile } from 'node:fs/promises'
import { testDatabaseEnv } from './lib/testDatabase'
const client = new Client({ connectionString: testDatabaseEnv().DATABASE_URL })
async function main() {
  const readyFile = process.argv[2]
  if (!readyFile) throw new Error('A ready-file path is required.')
  await client.connect()
  const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext('consilium-browser-workspace')) AS acquired")
  if (!rows[0].acquired) throw new Error('This test database is already in use. Choose a separate TEST_DATABASE_URL for concurrent runs.')
  await writeFile(readyFile, 'ready\n')
  const stop = async () => { await client.end(); process.exit(0) }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  client.on('error', error => { console.error(error.message); process.exit(1) })
  // The database connection holds the lease for the process lifetime.
  setInterval(() => { void client.query('SELECT 1').catch(() => process.exit(1)) }, 30_000)
}
main().catch(async error => { console.error(error.message); await client.end().catch(() => {}); process.exit(1) })
