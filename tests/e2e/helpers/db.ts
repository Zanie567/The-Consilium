/**
 * DB helpers for E2E assertions. The tests assert rendered counts against the
 * ACTUAL data layer (never hard-coded numbers), so they query Postgres directly
 * here and compare with what the browser renders.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../../../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

let prisma: PrismaClient | null = null
function db(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
    })
  }
  return prisma
}

export async function closeDb() {
  if (prisma) await prisma.$disconnect().catch(() => {})
  prisma = null
}

export interface CategoryExpectation {
  slug: string
  name: string
  publishedCount: number
  slugs: string[]
}

/** Published, non-deleted article count + slugs per category (debates included). */
export async function expectedCategoryArticles(): Promise<CategoryExpectation[]> {
  const categories = await db().category.findMany({ orderBy: { name: 'asc' } })
  const out: CategoryExpectation[] = []
  for (const cat of categories) {
    const articles = await db().article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null, categoryId: cat.id },
      select: { slug: true },
      orderBy: { publishedAt: 'desc' },
    })
    out.push({ slug: cat.slug, name: cat.name, publishedCount: articles.length, slugs: articles.map((a) => a.slug) })
  }
  return out
}

/** Every published, non-deleted article (slug + category slug). */
export async function allPublishedArticles() {
  return db().article.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    select: { slug: true, title: true, isDebate: true, category: { select: { slug: true } } },
    orderBy: { publishedAt: 'desc' },
  })
}

/** A published article that matches a search term in its title. */
export async function findPublishedByTitleContains(term: string) {
  return db().article.findFirst({
    where: { status: 'PUBLISHED', deletedAt: null, title: { contains: term, mode: 'insensitive' } },
    select: { slug: true, title: true },
  })
}

/**
 * Upserts a published article exercising the footnote pipeline: stale,
 * duplicated, out-of-order stored indices (the render renumbers them) plus
 * special characters, an attempted script tag, and a URL in the note text.
 * Returns the slug. Idempotent, safe to run repeatedly.
 */
export async function upsertFootnoteTestArticle(): Promise<string> {
  const writer = await db().user.findUnique({ where: { email: 'writer@theconsilium.com' } })
  if (!writer) throw new Error('seeded writer missing; run npm run test:setup-db')
  const category = await db().category.findFirst()

  const content = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'Inflation expectations remain anchored despite the spring energy shock.' },
        { type: 'footnoteRef', attrs: { index: 5, content: 'Bank of England, Monetary Policy Report, May 2026, p. 14.' } },
        { type: 'text', text: ' Survey measures tell a similar story across the income distribution.' },
      ]},
      { type: 'paragraph', content: [
        { type: 'text', text: 'The ONS revision changed the picture for services inflation.' },
        { type: 'footnoteRef', attrs: { index: 2, content: 'He said "watch the <script>alert(1)</script> & §catering» component" but the claim was 5 < 6 > 4.' } },
        { type: 'text', text: ' Markets barely moved on the release.' },
      ]},
      { type: 'paragraph', content: [
        { type: 'text', text: 'Longer series are available from the statistical bulletin.' },
        { type: 'footnoteRef', attrs: { index: 2, content: 'Full dataset at https://www.ons.gov.uk/economy/inflationandpriceindices?edition=2026&format=csv#downloads (accessed 9 June 2026).' } },
      ]},
      { type: 'paragraph', content: [
        { type: 'text', text: 'A final paragraph with enough text to make scrolling between the markers and the references list meaningful on a phone screen. The popover should never overflow the viewport at 375 pixels wide.' },
      ]},
    ],
  })

  // Fixed timestamp (not new Date()) so re-running the seed never reshuffles the
  // fixture's recency relative to the other seeded articles, which would make
  // recency-sensitive assertions flaky.
  const publishedAt = new Date('2026-01-01T00:00:00.000Z')

  const article = await db().article.upsert({
    where: { slug: 'footnote-popover-test' },
    update: { content, status: 'PUBLISHED', publishedAt, deletedAt: null },
    create: {
      slug: 'footnote-popover-test',
      title: 'Footnote popover test article',
      excerpt: 'A test article exercising footnote markers, including stale indices and special characters.',
      content,
      status: 'PUBLISHED',
      publishedAt,
      authorId: writer.id,
      categoryId: category?.id ?? null,
    },
  })
  return article.slug
}
