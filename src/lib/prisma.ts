import { assertRunDatabase } from '../../scripts/lib/assertRunDatabase'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseConnection } from './hostedDatabaseConnection'

// Typed as the configured client (which carries the User.password omit) rather
// than a bare PrismaClient, so the omit propagates to every consumer of `prisma`.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined
}

function createPrismaClient() {
  if (process.env.E2E_ISOLATED === '1') assertRunDatabase()
  const connectionString = process.env.DATABASE_URL!
  // Prisma 7 uses node-postgres pooling: URL connection_limit/pool_timeout
  // options from the old Prisma engine do not configure this adapter. `max`
  // applies per client/function instance, not across the Vercel deployment.
  // The acquisition timeout bounds pool waits, not SQL execution time.
  // Keep the existing defaults until an isolated hosted test establishes a
  // better pool budget; increasing this can exhaust Supavisor's client limit.
  const adapter = new PrismaPg({
    ...databaseConnection(process.env, connectionString),
    max: Number(process.env.DB_POOL_MAX ?? 10),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 8000),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? 30000),
  })
  return new PrismaClient({
    adapter,
    // Never return the bcrypt password hash by default. Every query that includes
    // a User (directly or via a relation like article.author) would otherwise
    // serialise the hash; this omit is the global safety net. The only code that
    // needs the hash — the credentials authorize() in auth.ts — overrides this
    // per-query with `omit: { password: false }`.
    omit: { user: { password: true } },
    log: process.env.NODE_ENV === 'development' ? ['error'] : [],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
