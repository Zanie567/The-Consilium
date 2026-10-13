import { prisma } from '@/lib/prisma'
import { buildDebateRow, type DebateAdminRow } from '@/lib/debateAdmin'

const articleSelect = {
  id: true, title: true, slug: true, status: true, deletedAt: true, publishedAt: true,
  author: { select: { name: true } },
} as const

/** Every debate, including unpublished and deleted ones, for the administrative list. */
export async function loadDebateAdminRows(): Promise<DebateAdminRow[]> {
  const [debates, voteGroups] = await Promise.all([
    prisma.debate.findMany({
      orderBy: { createdAt: 'desc' },
      include: { forArticle: { select: articleSelect }, againstArticle: { select: articleSelect } },
    }),
    // One grouped query for every debate (the old page ran one query per debate).
    prisma.debateVote.groupBy({ by: ['debateId', 'side'], _count: { _all: true } }),
  ])
  const tally = new Map<string, { for: number; against: number }>()
  for (const group of voteGroups) {
    const entry = tally.get(group.debateId) ?? { for: 0, against: 0 }
    if (group.side === 'FOR') entry.for = group._count._all
    else entry.against = group._count._all
    tally.set(group.debateId, entry)
  }
  const facts = (a: (typeof debates)[number]['forArticle']) => ({
    id: a.id, title: a.title, slug: a.slug, status: a.status, deletedAt: a.deletedAt,
    publishedAt: a.publishedAt, authorName: a.author?.name ?? null,
  })
  return debates.map((d) =>
    buildDebateRow(
      { ...d, forArticle: facts(d.forArticle), againstArticle: facts(d.againstArticle) },
      tally.get(d.id) ?? { for: 0, against: 0 },
    ),
  )
}
