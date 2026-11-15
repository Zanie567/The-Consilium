/**
 * Turns the tag names an article save carries into tag rows, inside the save transaction.
 *
 * The editor sends names (that is also what a local draft stores), and a name can reach a tag in
 * four ways, in this order:
 *   1. it IS a tag's name (same identity, canonicalTagSlug / consilium_tag_identity);
 *   2. the tag it names was merged: the merge target is used, so an old wording never re-creates
 *      the duplicate that was merged away;
 *   3. it is an approved alias of a tag;
 *   4. it names nothing: a tag manager's save creates the tag (as before); anyone else's save is
 *      refused with the names listed, and the editor offers to suggest them instead.
 *
 * A retired tag stays on an article that already carries it, so retiring never strips old articles
 * on their next save; it cannot be ADDED to an article.
 */
import type { Prisma } from '@prisma/client'
import type { NormalizedTag } from '@/lib/articleTags'
import { MAX_ARTICLE_TAGS } from '@/lib/tagIdentity'
import { resolveArticleTag } from '@/lib/resolveArticleTag'

export type TagSaveErrorCode = 'TAG_NOT_APPROVED' | 'TAG_RETIRED' | 'TOO_MANY_TAGS'

/** A save the tag rules refuse. Thrown inside the transaction so nothing is written. */
export class TagSaveError extends Error {
  constructor(
    readonly code: TagSaveErrorCode,
    message: string,
    readonly names: string[] = [],
  ) {
    super(message)
    this.name = 'TagSaveError'
  }
}

interface TagRow {
  id: string
  name: string
  retiredAt: Date | null
  mergedIntoId: string | null
}

export interface ResolveOptions {
  /** May this user create a tag that does not exist yet (TAG_MANAGE_ROLES)? */
  canCreate: boolean
  /** Tags the article carries now (empty for a new article). */
  currentTagIds: readonly string[]
}

async function tagByIdentity(tx: Prisma.TransactionClient, identity: string): Promise<TagRow | null> {
  const rows = await tx.$queryRaw<TagRow[]>`
    SELECT id, name, "retiredAt", "mergedIntoId" FROM tags
    WHERE public.consilium_tag_identity(name) = ${identity}
    ORDER BY "createdAt", id LIMIT 1`
  return rows[0] ?? null
}

async function tagByAlias(tx: Prisma.TransactionClient, identity: string): Promise<TagRow | null> {
  const rows = await tx.$queryRaw<TagRow[]>`
    SELECT t.id, t.name, t."retiredAt", t."mergedIntoId" FROM tag_aliases a JOIN tags t ON t.id = a."tagId"
    WHERE a.identity = ${identity} LIMIT 1`
  return rows[0] ?? null
}

async function tagById(tx: Prisma.TransactionClient, id: string): Promise<TagRow | null> {
  return tx.tag.findUnique({ where: { id }, select: { id: true, name: true, retiredAt: true, mergedIntoId: true } })
}

/** Resolves one name. Returns the tag, or why it cannot be used. */
async function resolveOne(
  tx: Prisma.TransactionClient,
  topic: NormalizedTag,
  options: ResolveOptions,
): Promise<{ tag: { id: string; name: string } } | { refused: 'unknown' | 'retired'; name: string }> {
  // Same lock the identity has always used: two saves creating one topic cannot both create it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${topic.slug}))`
  let row = (await tagByIdentity(tx, topic.slug)) ?? (await tagByAlias(tx, topic.slug))
  if (row?.mergedIntoId) row = await tagById(tx, row.mergedIntoId)
  if (row) {
    if (row.retiredAt && !options.currentTagIds.includes(row.id)) return { refused: 'retired', name: row.name }
    return { tag: { id: row.id, name: row.name } }
  }
  if (!options.canCreate) return { refused: 'unknown', name: topic.name }
  // Creation (and its legacy-URL handling) is the long-standing identity primitive.
  return { tag: await resolveArticleTag(tx, topic) }
}

/**
 * Resolves every name, de-duplicated by tag (two wordings of one tag count once), in a stable lock
 * order. Throws TagSaveError when any name is refused or the article would exceed the tag limit.
 */
export async function resolveArticleTags(
  tx: Prisma.TransactionClient,
  topics: readonly NormalizedTag[],
  options: ResolveOptions,
): Promise<{ id: string; name: string }[]> {
  const byId = new Map<string, { id: string; name: string }>()
  const unknown: string[] = []
  const retired: string[] = []
  for (const topic of [...topics].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const result = await resolveOne(tx, topic, options)
    if ('tag' in result) byId.set(result.tag.id, result.tag)
    else (result.refused === 'unknown' ? unknown : retired).push(result.name)
  }
  if (unknown.length) {
    throw new TagSaveError(
      'TAG_NOT_APPROVED',
      `${unknown.map((n) => `“${n}”`).join(', ')} ${unknown.length === 1 ? 'is not an approved tag' : 'are not approved tags'}. Choose an existing tag, or suggest a new one for review.`,
      unknown,
    )
  }
  if (retired.length) {
    throw new TagSaveError(
      'TAG_RETIRED',
      `${retired.map((n) => `“${n}”`).join(', ')} ${retired.length === 1 ? 'has been retired' : 'have been retired'} and cannot be added to an article.`,
      retired,
    )
  }
  // An article that already had more than the limit may keep them, but not gain more.
  const allowed = Math.max(MAX_ARTICLE_TAGS, options.currentTagIds.length)
  if (byId.size > allowed) {
    throw new TagSaveError('TOO_MANY_TAGS', `An article can have at most ${MAX_ARTICLE_TAGS} tags. Remove ${byId.size - allowed} to save.`)
  }
  return [...byId.values()]
}
