import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Typed as the configured client (which carries the User.password omit) rather
// than a bare PrismaClient, so the omit propagates to every consumer of `prisma`.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!
  // Pool hardening (Priority 2 — intermittent 503s under prefetch bursts).
  //   * `max`: explicit pool size. The serverless pooler URL pins this to 1
  //     connection; a burst of RSC prefetches then renders many pages that all
  //     queue on that single connection. Make it configurable so production can
  //     raise it above 1, while keeping a safe default for normal deployments.
  //   * `connectionTimeoutMillis`: fail fast instead of letting a render hang
  //     waiting for a connection until the platform kills the function with a
  //     503. A thrown error is caught by each page's try/catch and degrades to
  //     empty data (HTTP 200) rather than a hard 503.
  const adapter = new PrismaPg({
    connectionString,
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
