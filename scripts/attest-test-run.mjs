import fs from 'node:fs'
import { createRequire } from 'node:module'
import pg from 'pg'
const require = createRequire(import.meta.url)
// Typechecking is a separate required check; this startup guard must not repeat
// a whole TypeScript compilation before it can reject an unsafe target.
require('ts-node').register({ project: 'tsconfig.seed.json', transpileOnly: true })
// Reuse the production-project/ownership policy before any SELECT or HTTP call.
require('./lib/assertRunDatabase.ts').assertRunDatabase()
require('./lib/testServices.ts').assertIsolatedServiceEnv()
const expected={run:process.env.E2E_RUN_ID,database:new URL(process.env.TEST_DATABASE_URL).pathname.slice(1)}
const app=await fetch(`${process.env.E2E_BASE_URL}/api/test-attestation`)
const storage=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/__attestation`)
if(app.status!==200||storage.status!==200)throw new Error('Service attestation did not succeed')
async function queryDatabase(connectionString) {
  const client = new pg.Client({ connectionString })
  try { await client.connect(); const { rows } = await client.query('SELECT current_database() AS database'); return { run: expected.run, database: rows[0].database } }
  finally { await client.end() }
}
const actual={app:await app.json(),storage:await storage.json(),
  fixtures:await queryDatabase(process.env.TEST_DATABASE_URL),
  helpers:await queryDatabase(process.env.DATABASE_URL),
  cleanup:await queryDatabase(process.env.DIRECT_URL)}
for(const value of Object.values(actual))if(value.run!==expected.run||value.database!==expected.database)throw new Error('Database ownership mismatch')
fs.writeFileSync(`${process.env.E2E_RESULTS_DIR}/isolation.json`,JSON.stringify(actual,null,2))
