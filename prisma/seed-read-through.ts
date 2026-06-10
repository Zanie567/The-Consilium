/**
 * TEST-ONLY fixture for verifying the writer read-through analytics live.
 *
 * Creates, for the seeded writer (writer@theconsilium.com):
 *   - "The Long Read Experiment": a published article with 24 signed-in
 *     readers whose progress forms a known drop-off (cliff in the 30s).
 *     Hand-computed expectations the UI must show:
 *       readers 24, finished 21%, median furthest point 58%
 *       retention shares: 92, 92, 83, 58, 58, 50, 38, 29, 21, 8
 *       biggest drop between 30% and 40% (6 readers, 25%)
 *   - "The Small Sample": a published article with only 3 readers, which must
 *     show the "not enough data yet" state (threshold is 5).
 *   - Four DRAFT edge-case articles (rt-edge-*) used only by
 *     tests/integration/read-through-db.test.ts: no readers, one reader,
 *     all readers at 100%, all readers at 0%. Drafts so they never appear in
 *     public lists or the published-article test suites.
 *
 * Idempotent: articles upserted by slug, readers by email, progress rows by
 * the (userId, articleId) unique key. Safe to run repeatedly. The DB test
 * suite only reads this data (never writes), so it cannot race the other
 * DB-backed suites running in parallel vitest workers.
 *
 *   npx ts-node -P tsconfig.seed.json prisma/seed-read-through.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

// Same distribution as tests/unit/read-through.test.ts and
// tests/integration/read-through-db.test.ts.
const FIXTURE = [
  5, 8, 22, 26, 31, 33, 35, 36, 38, 39, 52, 55, 61, 64, 68, 72, 75, 81, 85, 90,
  93, 96, 100, 100,
]
const SMALL_SAMPLE = [10, 50, 80]

const doc = (paragraphs: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  })

async function upsertArticle(
  authorId: string,
  slug: string,
  title: string,
  daysAgo: number,
  status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED'
) {
  const publishedAt = status === 'PUBLISHED'
    ? new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    : null
  return prisma.article.upsert({
    where: { slug },
    update: { status, publishedAt, deletedAt: null },
    create: {
      title,
      slug,
      status,
      publishedAt,
      authorId,
      excerpt: 'A fixture article for verifying read-through analytics.',
      content: doc(
        Array.from({ length: 14 }, (_, i) =>
          `Paragraph ${i + 1}. This fixture text only exists so the article has a realistic scroll length for the read-through verification.`
        )
      ),
    },
  })
}

async function seedReaders(articleId: string, progresses: number[], emailPrefix: string) {
  for (let i = 0; i < progresses.length; i++) {
    const progress = progresses[i]
    const reader = await prisma.user.upsert({
      where: { email: `${emailPrefix}-${String(i + 1).padStart(2, '0')}@consilium.test` },
      update: {},
      create: {
        email: `${emailPrefix}-${String(i + 1).padStart(2, '0')}@consilium.test`,
        name: `Read-through Reader ${i + 1}`,
        role: 'READER',
      },
    })
    await prisma.readingProgress.upsert({
      where: { userId_articleId: { userId: reader.id, articleId } },
      update: { progress, completed: progress >= 90 },
      create: {
        userId: reader.id,
        articleId,
        progress,
        scrollY: Math.round(progress * 60),
        completed: progress >= 90,
      },
    })
  }
}

async function main() {
  const writer = await prisma.user.findUnique({
    where: { email: 'writer@theconsilium.com' },
    select: { id: true },
  })
  if (!writer) {
    throw new Error('Seeded writer not found. Run the main seed (npm run db:seed) first.')
  }

  const longRead = await upsertArticle(
    writer.id,
    'the-long-read-experiment',
    'The Long Read Experiment',
    14
  )
  await seedReaders(longRead.id, FIXTURE, 'rt-reader')

  const smallSample = await upsertArticle(
    writer.id,
    'the-small-sample',
    'The Small Sample',
    7
  )
  await seedReaders(smallSample.id, SMALL_SAMPLE, 'rt-small-reader')

  // Aggregation edge cases for the DB-backed test suite, kept as drafts.
  await upsertArticle(writer.id, 'rt-edge-empty', 'RT Edge: No Readers', 0, 'DRAFT')
  const single = await upsertArticle(writer.id, 'rt-edge-single', 'RT Edge: One Reader', 0, 'DRAFT')
  await seedReaders(single.id, [42], 'rt-reader')
  const all100 = await upsertArticle(writer.id, 'rt-edge-all100', 'RT Edge: Everyone Finishes', 0, 'DRAFT')
  await seedReaders(all100.id, [100, 100, 100, 100, 100, 100], 'rt-reader')
  const all0 = await upsertArticle(writer.id, 'rt-edge-all0', 'RT Edge: Nobody Starts', 0, 'DRAFT')
  await seedReaders(all0.id, [0, 0, 0, 0, 0], 'rt-reader')

  console.log('Read-through fixtures ready:')
  console.log(`  ${longRead.slug}: 24 readers, expect finished 21%, median 58%, drop 30-40%`)
  console.log(`  ${smallSample.slug}: 3 readers, expect the "not enough data yet" state`)
  console.log('  rt-edge-*: draft edge-case articles for the DB aggregation tests')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
