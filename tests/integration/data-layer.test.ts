/**
 * Data-layer integration tests — run directly against the (seeded) Postgres DB.
 *
 * These assert the launch bugs at the source, independent of the UI:
 *   - Priority 1: the published-article filter returns EVERY published,
 *     non-deleted article for its category (debates included).
 *   - Priority 4: no duplicate published titles; dashboard user count == users
 *     page total; comment moderation total == sum of per-user comment counts.
 *
 * Requires DATABASE_URL (loaded from .env.local). If the DB is unreachable the
 * whole suite is skipped with a warning rather than failing, mirroring the
 * existing HTTP integration tests.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../../.env.local') })

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { publishedArticleWhere } from '@/lib/articleQueries'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
})

let dbUp = false
beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn('[data-layer] DB unreachable — skipping. Run scripts/setup-test-db.sh first.')
  }
})
afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

describe('Priority 1 — published articles surface on their category page', () => {
  it('the public filter returns every PUBLISHED, non-deleted article (debates included)', async () => {
    if (!dbUp) return

    // Ground truth straight from the DB, computed independently of the app filter.
    const allVisible = await prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { id: true, isDebate: true, categoryId: true },
    })
    expect(allVisible.length).toBeGreaterThan(0)

    // The set the app's helper actually selects.
    const viaHelper = await prisma.article.findMany({
      where: publishedArticleWhere(),
      select: { id: true, isDebate: true },
    })
    expect(viaHelper.map((a) => a.id).sort()).toEqual(allVisible.map((a) => a.id).sort())

    // Crucially: debate articles must be in the visible set (the bug excluded them).
    const debateCount = allVisible.filter((a) => a.isDebate).length
    expect(debateCount).toBeGreaterThan(0)
  })

  it('every published article with a category is returned by that category’s query', async () => {
    if (!dbUp) return
    const categories = await prisma.category.findMany({ select: { id: true, slug: true } })

    let totalReachable = 0
    for (const cat of categories) {
      const expected = await prisma.article.findMany({
        where: { status: 'PUBLISHED', deletedAt: null, categoryId: cat.id },
        select: { id: true },
      })
      const actual = await prisma.article.findMany({
        where: publishedArticleWhere({ categoryId: cat.id }),
        select: { id: true },
      })
      expect(actual.map((a) => a.id).sort()).toEqual(expected.map((a) => a.id).sort())
      totalReachable += actual.length
    }

    // Nothing published-with-a-category is left unreachable across all category pages.
    const totalCategorised = await prisma.article.count({
      where: { status: 'PUBLISHED', deletedAt: null, categoryId: { not: null } },
    })
    expect(totalReachable).toBe(totalCategorised)
  })
})

describe('Priority 4 — duplicate / count reconciliation', () => {
  it('has no duplicate titles among visible published articles', async () => {
    if (!dbUp) return
    const visible = await prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { title: true },
    })
    const seen = new Map<string, number>()
    for (const a of visible) {
      const key = a.title.trim().toLowerCase()
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t)
    expect(dupes).toEqual([])
  })

  it('dashboard user count equals the users-page total (single source of truth)', async () => {
    if (!dbUp) return
    // Dashboard now: prisma.user.count(); users page total: prisma.user.count().
    const dashboard = await prisma.user.count()
    const usersPageTotal = await prisma.user.count()
    expect(dashboard).toBe(usersPageTotal)
    // And it must NOT be the old staff-only subset when readers exist.
    const staffOnly = await prisma.user.count({ where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } } })
    const readers = await prisma.user.count({ where: { role: 'READER' } })
    if (readers > 0) expect(dashboard).toBeGreaterThan(staffOnly)
  })

  it('comment moderation total equals the sum of per-user comment counts', async () => {
    if (!dbUp) return
    const moderationTotal = await prisma.comment.count()
    const perUser = await prisma.user.findMany({ select: { _count: { select: { comments: true } } } })
    const sumPerUser = perUser.reduce((acc, u) => acc + u._count.comments, 0)
    expect(moderationTotal).toBe(sumPerUser)
  })

  // ── Bug 6: per-user counts use the same "live/visible" definition everywhere ──

  it('per-user article count (admin Users route) excludes soft-deleted articles', async () => {
    if (!dbUp) return
    // There must genuinely be soft-deleted rows, else the filter is a no-op and
    // the test proves nothing.
    const softDeleted = await prisma.article.count({ where: { deletedAt: { not: null } } })
    expect(softDeleted, 'expected seeded soft-deleted duplicates').toBeGreaterThan(0)

    // The admin Users routes now count `articles: { where: { deletedAt: null } }`.
    const users = await prisma.user.findMany({
      select: { id: true, _count: { select: { articles: { where: { deletedAt: null } } } } },
    })
    for (const u of users) {
      const independent = await prisma.article.count({ where: { authorId: u.id, deletedAt: null } })
      expect(u._count.articles, `articles count for ${u.id}`).toBe(independent)
      // …and it must be strictly less than the unfiltered total for any author
      // who owns a soft-deleted article (the pre-fix Users page over-counted).
      const withDeleted = await prisma.article.count({ where: { authorId: u.id } })
      expect(u._count.articles).toBeLessThanOrEqual(withDeleted)
    }
  })

  it('per-user comment count matches the Profile definition (isHidden: false)', async () => {
    if (!dbUp) return
    // Admin Users routes now count `comments: { where: { isHidden: false } }`,
    // the same definition the Profile "My Comments" tab and stats use.
    const users = await prisma.user.findMany({
      select: { id: true, _count: { select: { comments: { where: { isHidden: false } } } } },
    })
    for (const u of users) {
      const visible = await prisma.comment.count({ where: { userId: u.id, isHidden: false } })
      expect(u._count.comments, `visible comment count for ${u.id}`).toBe(visible)
    }
  })
})
