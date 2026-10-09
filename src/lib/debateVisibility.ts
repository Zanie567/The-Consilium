import type { Prisma } from '@prisma/client'

/**
 * Single definition of "this debate is publicly visible", the debate counterpart of
 * `publishedArticleWhere` in articleQueries.ts. Every public surface (homepage panel,
 * /opinion-debate, the active-debate and vote APIs, a member's vote history) must build
 * its filter from here so a debate cannot be hidden in one place and still votable in
 * another.
 *
 * `isActive` is NOT part of visibility: it means "the featured debate". A past debate
 * stays publicly readable until an administrator unpublishes or deletes it.
 */
export const PUBLIC_DEBATE_WHERE = {
  deletedAt: null,
  unpublishedAt: null,
} as const satisfies Prisma.DebateWhereInput

export function publicDebateWhere(extra?: Prisma.DebateWhereInput): Prisma.DebateWhereInput {
  return { ...PUBLIC_DEBATE_WHERE, ...extra }
}

export type DebateVisibility = 'published' | 'unpublished' | 'deleted'

export interface DebateVisibilityFacts {
  unpublishedAt: Date | string | null
  deletedAt: Date | string | null
}

/** Deleted wins over unpublished: a soft-deleted debate also keeps its unpublished timestamp. */
export function debateVisibility(debate: DebateVisibilityFacts): DebateVisibility {
  if (debate.deletedAt) return 'deleted'
  if (debate.unpublishedAt) return 'unpublished'
  return 'published'
}

export const DEBATE_VISIBILITY_LABEL: Record<DebateVisibility, string> = {
  published: 'Published',
  unpublished: 'Unpublished',
  deleted: 'Deleted',
}
