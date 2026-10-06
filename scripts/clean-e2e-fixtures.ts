/**
 * Optional reset for one explicitly selected WF run prefix, owned by a verified
 * test persona. Default is read-only. Never deletes other runs or arbitrary cards.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { testDatabaseEnv } from './lib/testDatabase'

async function main() {
  const { DATABASE_URL } = testDatabaseEnv()
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
  try {
    const prefix = process.env.E2E_CLEAN_RUN_PREFIX
    if (!prefix || !/^WF [a-zA-Z0-9.-]+ /.test(prefix)) {
      process.stdout.write('→ no explicit run prefix; preserving other runs\n')
      return
    }
    const rows = await prisma.article.findMany({
      where: { title: { startsWith: prefix }, author: { testPersonaKey: { not: null } } },
      select: { id: true },
    })
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) return
    await prisma.notification.deleteMany({ where: { articleId: { in: ids } } })
    await prisma.articleComment.deleteMany({ where: { articleId: { in: ids } } })
    await prisma.articleTag.deleteMany({ where: { articleId: { in: ids } } })
    const { count } = await prisma.article.deleteMany({ where: { id: { in: ids } } })
    process.stdout.write(`→ removed ${count} leftover test article(s)\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exit(1)
})
