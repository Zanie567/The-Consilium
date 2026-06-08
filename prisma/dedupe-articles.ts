/**
 * One-off / repeatable de-duplication of articles.
 *
 * Background (Priority 4): an early version of prisma/seed-debates.ts created a
 * brand-new pair of debate articles on every run (uniqueSlug + create) while the
 * Debate row kept pointing at the original pair. Running it twice left each
 * debate article duplicated, with the extra copy orphaned (referenced by no
 * Debate) and carrying zero reader engagement.
 *
 * This script collapses such duplicates safely:
 *   - Group non-deleted articles by normalised title.
 *   - In each group of >1, choose a canonical row to KEEP, preferring
 *       (1) a row referenced by a Debate, then
 *       (2) the row with the most reader engagement, then
 *       (3) the oldest row.
 *   - Soft-delete (set deletedAt) the other copies — but ONLY when they carry no
 *     reader engagement (no comments, bookmarks, views, reading progress or
 *     notes). Anything with engagement is left untouched and reported, so no
 *     real content is ever lost.
 *
 * Soft-delete (not hard delete) means the removed copies land in the editorial
 * Trash, where a human can review and permanently purge them. Re-runnable and
 * idempotent. Pass --dry to preview without writing.
 *
 *   npx ts-node -P tsconfig.seed.json prisma/dedupe-articles.ts [--dry]
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

const DRY = process.argv.includes('--dry')

function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function main() {
  const articles = await prisma.article.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      isDebate: true,
      createdAt: true,
      _count: {
        select: {
          comments: true,
          bookmarks: true,
          views: true,
          readingProgress: true,
          notes: true,
        },
      },
      forDebates: { select: { id: true } },
      againstDebates: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const engagement = (a: (typeof articles)[number]) =>
    a._count.comments + a._count.bookmarks + a._count.views + a._count.readingProgress + a._count.notes
  const isReferenced = (a: (typeof articles)[number]) =>
    a.forDebates.length > 0 || a.againstDebates.length > 0

  // Group by normalised title
  const groups = new Map<string, typeof articles>()
  for (const a of articles) {
    const key = normaliseTitle(a.title)
    const list = groups.get(key) ?? []
    list.push(a)
    groups.set(key, list)
  }

  const toSoftDelete: string[] = []
  let keptWithEngagement = 0

  for (const [, group] of groups) {
    if (group.length < 2) continue

    // Pick the canonical row: referenced > most engagement > oldest.
    const canonical = [...group].sort((a, b) => {
      if (isReferenced(a) !== isReferenced(b)) return isReferenced(a) ? -1 : 1
      if (engagement(a) !== engagement(b)) return engagement(b) - engagement(a)
      return a.createdAt.getTime() - b.createdAt.getTime()
    })[0]

    console.log(`\nDuplicate title: "${group[0].title}" (${group.length} copies)`)
    console.log(`  KEEP   ${canonical.slug}  [referenced=${isReferenced(canonical)} engagement=${engagement(canonical)}]`)

    for (const a of group) {
      if (a.id === canonical.id) continue
      if (engagement(a) > 0 || isReferenced(a)) {
        // Has real content or is wired into a debate — never auto-remove.
        keptWithEngagement++
        console.log(`  SKIP   ${a.slug}  [referenced=${isReferenced(a)} engagement=${engagement(a)}] — has content, left in place`)
        continue
      }
      toSoftDelete.push(a.id)
      console.log(`  REMOVE ${a.slug}  [orphaned duplicate, zero engagement]`)
    }
  }

  console.log(`\n${'─'.repeat(60)}`)
  if (toSoftDelete.length === 0) {
    console.log('No removable duplicates found. Database is clean. ✓')
  } else if (DRY) {
    console.log(`[dry run] would soft-delete ${toSoftDelete.length} duplicate article(s).`)
  } else {
    const res = await prisma.article.updateMany({
      where: { id: { in: toSoftDelete } },
      data: { deletedAt: new Date() },
    })
    console.log(`Soft-deleted ${res.count} duplicate article(s) → now in editorial Trash for review.`)
  }
  if (keptWithEngagement > 0) {
    console.log(`${keptWithEngagement} duplicate(s) had engagement and were left untouched (review manually).`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
