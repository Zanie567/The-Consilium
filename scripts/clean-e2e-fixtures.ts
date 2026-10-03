/**
 * Removes the articles earlier browser runs left behind (titles starting "WF " or
 * "E2E "), so the test database does not grow forever and list/queue assertions are not
 * working against hundreds of leftovers. Test database only: the host guard runs first.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { testDatabaseEnv } from './lib/testDatabase'

async function main() {
  const { DATABASE_URL } = testDatabaseEnv()
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
  try {
    const rows = await prisma.article.findMany({
      where: { OR: [{ title: { startsWith: 'WF ' } }, { title: { startsWith: 'E2E ' } }] },
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
