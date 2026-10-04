import fs from 'node:fs'
const expected={run:process.env.E2E_RUN_ID,database:new URL(process.env.TEST_DATABASE_URL).pathname.slice(1)}
const app=await fetch(`${process.env.E2E_BASE_URL}/api/test-attestation`)
const storage=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/__attestation`)
if(app.status!==200||storage.status!==200)throw new Error('Service attestation did not succeed')
const actual={app:await app.json(),storage:await storage.json(),fixtures:expected,helpers:expected,cleanup:expected}
for(const value of Object.values(actual))if(value.run!==expected.run||value.database!==expected.database)throw new Error('Database ownership mismatch')
fs.writeFileSync(`${process.env.E2E_RESULTS_DIR}/isolation.json`,JSON.stringify(actual,null,2))
