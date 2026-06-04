import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Typed as the configured client (which carries the User.password omit) rather
// than a bare PrismaClient, so the omit propagates to every consumer of `prisma`.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!
  const adapter = new PrismaPg({ connectionString })
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
