/** Read-only gate. Explicit target only; never loads dotenv or applies migrations. */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { deploymentReadiness } from '../src/lib/deploymentReadiness'
async function main() {
  if (!process.env.DIRECT_URL) throw new Error('Explicit DIRECT_URL is required.')
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
  try {
    const result = await deploymentReadiness(db)
    console.log(JSON.stringify(result, null, 2))
    if (!result.healthy) process.exitCode = 1
    if (process.env.SMOKE_BASE_URL) {
      const base = new URL(process.env.SMOKE_BASE_URL)
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Smoke URL must be an origin without credentials, path, query or fragment.')
      for (const path of ['/', '/team', '/api/team', '/editorial/login']) {
        const response = await fetch(new URL(path, base), { redirect: 'manual' })
        console.log(`${path}: ${response.status}`)
        if (response.status !== 200) process.exitCode = 1
      }
    }
  } finally { await db.$disconnect() }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
