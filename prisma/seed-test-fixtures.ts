/**
 * TEST-ONLY fixtures. Layered on top of the real seeds (seed.ts + seed-debates.ts
 * + dedupe-articles.ts) to create the conditions the launch bugs lived in, so the
 * automated suite can assert they stay fixed:
 *
 *   - Reader / Growth accounts, so total users > staff count (Priority 4: the
 *     dashboard "Users" stat must match the users page, not just count staff).
 *   - Real comments by those readers with known per-author counts, so the
 *     comment-count reconciliation (moderation total == sum of per-user counts)
 *     is exercised (Priority 4).
 *   - A scheduled (future) and an archived article, so "published only" filters
 *     are exercised against neighbouring statuses.
 *
 * Idempotent: users are upserted by email; comments are only created if the
 * reader has none yet. Safe to run repeatedly.
 *
 *   npx ts-node -P tsconfig.seed.json prisma/seed-test-fixtures.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

// reader email -> number of comments they should have
const READERS: Record<string, number> = {
  'reader.alice@consilium.test': 4,
  'reader.bob@consilium.test': 1,
  'reader.carol@consilium.test': 2,
}

async function main() {
  const password = await bcrypt.hash('reader1234', 10)

  // Growth account (counts toward total users but not staff-article counts)
  await prisma.user.upsert({
    where: { email: 'growth@consilium.test' },
    update: {},
    create: { email: 'growth@consilium.test', name: 'Growth Lead', role: 'GROWTH', password, slug: 'growth-lead' },
  })

  // A target published article for the comments to hang off.
  const article = await prisma.article.findFirst({
    where: { status: 'PUBLISHED', deletedAt: null },
    orderBy: { publishedAt: 'desc' },
    select: { id: true },
  })
  if (!article) throw new Error('No published article found — run the main seeds first.')

  let createdComments = 0
  for (const [email, count] of Object.entries(READERS)) {
    const name = email.split('@')[0].replace('reader.', 'Reader ')
    const reader = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role: 'READER', password, slug: email.split('@')[0].replace('.', '-') },
    })

    const existing = await prisma.comment.count({ where: { userId: reader.id } })
    if (existing >= count) continue
    for (let i = existing; i < count; i++) {
      await prisma.comment.create({
        data: {
          articleId: article.id,
          userId: reader.id,
          body: `Test comment ${i + 1} from ${name}. Thoughtful remark about the article.`,
        },
      })
      createdComments++
    }
  }

  // A scheduled (future) article and an archived one, to exercise status filters.
  const author = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  const category = await prisma.category.findFirst({ where: { slug: 'news' } })
  if (author) {
    await prisma.article.upsert({
      where: { slug: 'test-scheduled-future-piece' },
      update: {},
      create: {
        title: 'Scheduled: A Future Economic Outlook',
        slug: 'test-scheduled-future-piece',
        content: JSON.stringify({ type: 'doc', content: [] }),
        excerpt: 'A scheduled piece that should never appear on public lists.',
        authorId: author.id,
        categoryId: category?.id ?? null,
        status: 'SCHEDULED',
        scheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    await prisma.article.upsert({
      where: { slug: 'test-archived-piece' },
      update: {},
      create: {
        title: 'Archived: An Old Economic Note',
        slug: 'test-archived-piece',
        content: JSON.stringify({ type: 'doc', content: [] }),
        excerpt: 'An archived piece that should never appear on public lists.',
        authorId: author.id,
        categoryId: category?.id ?? null,
        status: 'ARCHIVED',
        publishedAt: new Date('2024-01-01'),
      },
    })
  }

  const [totalUsers, totalComments] = await Promise.all([
    prisma.user.count(),
    prisma.comment.count(),
  ])
  console.log(`✅ Test fixtures ready. Created ${createdComments} comment(s).`)
  console.log(`   Total users: ${totalUsers}, total comments: ${totalComments}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
