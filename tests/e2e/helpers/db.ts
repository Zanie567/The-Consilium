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
