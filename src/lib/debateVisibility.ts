import type { Prisma } from '@prisma/client'
import { publishedArticleWhere } from '@/lib/articleQueries'

/**
 * The debate's OWN state: not deleted and not unpublished. This is only half of "public": an editor can archive
 * or trash either argument on its own, and the debate row says nothing about that. Use it for administrative
 * classification; never to decide what a visitor may see.
 */
export const DEBATE_OWN_STATE_PUBLISHED_WHERE = {
  deletedAt: null,
  unpublishedAt: null,
} as const satisfies Prisma.DebateWhereInput

/**
 * Single definition of "this debate is publicly visible", the debate counterpart of
 * `publishedArticleWhere` in articleQueries.ts. Every public surface (homepage panel,
 * /opinion-debate, the active-debate and vote APIs, a member's vote history and its statistics)
 * must build its filter from here so a debate cannot be hidden in one place and still readable or
 * votable in another.
 *
 * Fail closed: the debate is public only when the debate itself is published AND BOTH of its articles are
 * public by the application's one article rule (PUBLISHED, not trashed, not part of a hidden debate). If either
 * side is archived, drafted, scheduled, trashed, or its relation cannot be resolved, the whole debate is absent:
 * a debate is never shown with one argument missing, and nothing is republished to make it appear.
 *
 * Both relations are required, so the relation filter also excludes a row whose article no longer exists.
 *
 * `isActive` is NOT part of visibility: it means "the featured debate". A past debate
 * stays publicly readable until an administrator unpublishes or deletes it.
 */
export const PUBLIC_DEBATE_WHERE = {
  ...DEBATE_OWN_STATE_PUBLISHED_WHERE,
  forArticle: publishedArticleWhere(),
  againstArticle: publishedArticleWhere(),
} satisfies Prisma.DebateWhereInput

/** The shared rule plus extra narrowing. `extra` is ANDed, so it can never loosen or replace a visibility condition. */
export function publicDebateWhere(extra?: Prisma.DebateWhereInput): Prisma.DebateWhereInput {
  return extra ? { AND: [PUBLIC_DEBATE_WHERE, extra] } : PUBLIC_DEBATE_WHERE
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
