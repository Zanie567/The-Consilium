/**
 * Tag taxonomy management: everything /editorial/tags and its API do to tags.
 *
 * Rules every operation keeps:
 *   - a tag's slug never changes, so its public address is permanent;
 *   - one wording names one tag: a name or alias may not share its identity with any other tag or
 *     alias (the database enforces this too: tags_canonical_identity_key, tag_aliases_identity_key and
 *     the triggers in 20261115120000_tag_taxonomy.sql);
 *   - nothing is deleted: retiring hides a tag from editors, merging moves its articles and leaves the
 *     old tag as a redirect, and a merge can be undone from what the audit log recorded;
 *   - every change is written to the audit log.
 *
 * Permission checks happen in the API routes (TAG_MANAGE_ROLES); these functions trust their caller.
 */
import { Prisma } from '@prisma/client'
import type { prisma as appPrisma } from '@/lib/prisma'
import { canonicalTagSlug, topicDisplayName } from '@/lib/tagIdentity'
import { normalizeArticleTags } from '@/lib/articleTags'
import { resolveArticleTag } from '@/lib/resolveArticleTag'
import { stripHtml } from '@/lib/content-filter'

/** The app's client (or a test's client of the same shape). */
type PrismaClient = typeof appPrisma
type Db = PrismaClient | Prisma.TransactionClient

export type TagManageErrorCode =
  | 'INVALID_NAME'
  | 'NAME_TAKEN'
  | 'NOT_FOUND'
  | 'TAG_MERGED'
  | 'INVALID_MERGE'
  | 'NOTHING_TO_UNDO'
  | 'ALREADY_REVIEWED'

/** A refused management action, with what the person needs to know to fix it. */
export class TagManageError extends Error {
  constructor(
    readonly code: TagManageErrorCode,
    message: string,
    readonly status: number,
    /** The tag a refused name already belongs to. */
    readonly existing?: { id: string; name: string; slug: string },
  ) {
    super(message)
    this.name = 'TagManageError'
  }
}

const MAX_NAME = 80
const MAX_DESCRIPTION = 500

/** A display name as stored: markup removed, whitespace collapsed, NFKC, at most 80 characters. */
export function cleanTagName(raw: unknown): { name: string; identity: string } {
  if (typeof raw !== 'string') throw new TagManageError('INVALID_NAME', 'Enter a tag name.', 400)
  const name = topicDisplayName(stripHtml(raw))
  const identity = canonicalTagSlug(name)
  if (!name || !identity) throw new TagManageError('INVALID_NAME', 'A tag name needs at least one letter or number.', 400)
  if (raw.trim().length > MAX_NAME) throw new TagManageError('INVALID_NAME', `A tag name can be at most ${MAX_NAME} characters.`, 400)
  return { name, identity }
}

function cleanDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new TagManageError('INVALID_NAME', 'The description must be text.', 400)
  const text = stripHtml(raw).replace(/\s+/g, ' ').trim()
  if (text.length > MAX_DESCRIPTION) throw new TagManageError('INVALID_NAME', `A description can be at most ${MAX_DESCRIPTION} characters.`, 400)
  return text || null
}

/** Serialises every change to one wording, the same lock the article-save path takes. */
async function lockIdentity(tx: Prisma.TransactionClient, identity: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity}))`
}

/** Which tag (if any) already answers to this wording, by name or by alias. */
export async function findTagByWording(db: Db, identity: string): Promise<{ id: string; name: string; slug: string; via: 'name' | 'alias' } | null> {
  const byName = await db.$queryRaw<{ id: string; name: string; slug: string }[]>`
    SELECT id, name, slug FROM tags WHERE public.consilium_tag_identity(name) = ${identity} LIMIT 1`
  if (byName[0]) return { ...byName[0], via: 'name' }
  const alias = await db.tagAlias.findUnique({ where: { identity }, select: { tag: { select: { id: true, name: true, slug: true } } } })
  return alias ? { ...alias.tag, via: 'alias' } : null
}

async function assertWordingFree(tx: Prisma.TransactionClient, identity: string, name: string, exceptTagId?: string) {
  const taken = await findTagByWording(tx, identity)
  if (taken && taken.id !== exceptTagId) {
    throw new TagManageError(
      'NAME_TAKEN',
      taken.via === 'name' ? `“${taken.name}” already exists.` : `“${name}” is already another name for “${taken.name}”.`,
      409,
      { id: taken.id, name: taken.name, slug: taken.slug },
    )
  }
}

async function audit(tx: Prisma.TransactionClient, action: string, tagId: string, userId: string, metadata: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { action, targetId: tagId, targetType: 'tag', performedBy: userId, metadata } })
}

async function activeTag(tx: Prisma.TransactionClient, id: string) {
  const tag = await tx.tag.findUnique({ where: { id }, select: { id: true, name: true, slug: true, retiredAt: true, mergedIntoId: true } })
  if (!tag) throw new TagManageError('NOT_FOUND', 'That tag no longer exists.', 404)
  return tag
}

function serializable<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(work, { timeout: 15_000 })
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────

export interface ManagedTag {
  id: string
  name: string
  slug: string
  description: string | null
  createdAt: string
  retiredAt: string | null
  mergedInto: { id: string; name: string; slug: string } | null
  aliases: { id: string; name: string }[]
  /** Articles carrying the tag, trashed ones excluded. */
  articleCount: number
  /** Of those, how many readers can see. */
  publishedCount: number
}

export async function listManagedTags(db: PrismaClient): Promise<ManagedTag[]> {
  const [tags, counts] = await Promise.all([
    db.tag.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true, name: true, slug: true, description: true, createdAt: true, retiredAt: true,
        mergedInto: { select: { id: true, name: true, slug: true } },
        aliases: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
    }),
    db.$queryRaw<{ tagId: string; total: bigint; published: bigint }[]>`
      SELECT at."tagId", count(*) AS total, count(*) FILTER (WHERE a.status = 'PUBLISHED') AS published
      FROM article_tags at JOIN articles a ON a.id = at."articleId"
      WHERE a."deletedAt" IS NULL
      GROUP BY at."tagId"`,
  ])
  const byTag = new Map(counts.map((c) => [c.tagId, c]))
  return tags.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    retiredAt: t.retiredAt?.toISOString() ?? null,
    articleCount: Number(byTag.get(t.id)?.total ?? 0),
    publishedCount: Number(byTag.get(t.id)?.published ?? 0),
  }))
}

/** What the editor's tag selector needs: every tag that can appear on an article, with its aliases. */
export async function listTagOptions(db: PrismaClient) {
  const tags = await listManagedTags(db)
  return tags
    .filter((t) => !t.mergedInto)
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, aliases: t.aliases.map((a) => a.name), articleCount: t.articleCount, retired: t.retiredAt !== null }))
}

export interface PendingSuggestion {
  id: string
  name: string
  note: string | null
  createdAt: string
  suggestedBy: { id: string; name: string | null }
  article: { id: string; title: string } | null
}

export async function listPendingSuggestions(db: PrismaClient): Promise<PendingSuggestion[]> {
  const rows = await db.tagSuggestion.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true, name: true, note: true, createdAt: true,
      suggestedBy: { select: { id: true, name: true } },
      article: { select: { id: true, title: true, deletedAt: true } },
    },
  })
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    article: r.article && !r.article.deletedAt ? { id: r.article.id, title: r.article.title } : null,
  }))
}

// ── Creating and editing ────────────────────────────────────────────────────────────────────────────

export async function createTag(db: PrismaClient, input: { name: unknown; description?: unknown }, userId: string) {
  const { name, identity } = cleanTagName(input.name)
  const description = cleanDescription(input.description)
  return serializable(db, async (tx) => {
    await lockIdentity(tx, identity)
    await assertWordingFree(tx, identity, name)
    const [topic] = normalizeArticleTags([name])
    const created = await resolveArticleTag(tx, topic)
    const tag = await tx.tag.update({ where: { id: created.id }, data: { description }, select: { id: true, name: true, slug: true } })
    await audit(tx, 'tag.create', tag.id, userId, { name: tag.name, slug: tag.slug })
    return tag
  })
}

/**
 * Renames a tag's display name. The slug (its address) stays. When the new name is a different
 * wording, the old name becomes an alias, so editors and old local drafts using it still find the tag.
 */
export async function renameTag(db: PrismaClient, id: string, rawName: unknown, userId: string) {
  const { name, identity } = cleanTagName(rawName)
  return serializable(db, async (tx) => {
    const tag = await activeTag(tx, id)
    if (tag.mergedIntoId) throw new TagManageError('TAG_MERGED', 'A merged tag cannot be renamed. Undo the merge first.', 409)
    const oldIdentity = canonicalTagSlug(tag.name)
    await lockIdentity(tx, identity)
    if (oldIdentity !== identity) await lockIdentity(tx, oldIdentity)
    // Renaming onto one of this tag's own aliases swaps them.
    const ownAlias = await tx.tagAlias.findFirst({ where: { tagId: id, identity }, select: { id: true } })
    if (ownAlias) await tx.tagAlias.delete({ where: { id: ownAlias.id } })
    else await assertWordingFree(tx, identity, name, id)
    const updated = await tx.tag.update({ where: { id }, data: { name }, select: { id: true, name: true, slug: true } })
    if (oldIdentity !== identity) await tx.tagAlias.create({ data: { tagId: id, name: tag.name, identity: oldIdentity, createdById: userId } })
    await audit(tx, 'tag.rename', id, userId, { from: tag.name, to: name, oldNameKeptAsAlias: oldIdentity !== identity })
    return updated
  })
}

export async function setTagDescription(db: PrismaClient, id: string, raw: unknown, userId: string) {
  const description = cleanDescription(raw)
  return serializable(db, async (tx) => {
    await activeTag(tx, id)
    const tag = await tx.tag.update({ where: { id }, data: { description }, select: { id: true, description: true } })
    await audit(tx, 'tag.describe', id, userId, { description })
    return tag
  })
}

export async function addTagAlias(db: PrismaClient, tagId: string, rawName: unknown, userId: string) {
  const { name, identity } = cleanTagName(rawName)
  return serializable(db, async (tx) => {
    const tag = await activeTag(tx, tagId)
    if (tag.mergedIntoId) throw new TagManageError('TAG_MERGED', 'Add the alias to the tag this one was merged into.', 409)
    await lockIdentity(tx, identity)
    await assertWordingFree(tx, identity, name)
    const alias = await tx.tagAlias.create({ data: { tagId, name, identity, createdById: userId }, select: { id: true, name: true } })
    await audit(tx, 'tag.alias.add', tagId, userId, { alias: name })
    return alias
  })
}

export async function removeTagAlias(db: PrismaClient, tagId: string, aliasId: string, userId: string) {
  return serializable(db, async (tx) => {
    const alias = await tx.tagAlias.findFirst({ where: { id: aliasId, tagId }, select: { id: true, name: true } })
    if (!alias) throw new TagManageError('NOT_FOUND', 'That alias no longer exists.', 404)
    await tx.tagAlias.delete({ where: { id: aliasId } })
    await audit(tx, 'tag.alias.remove', tagId, userId, { alias: alias.name })
  })
}

/** Retiring stops a tag being added to articles. Articles keep it and its page keeps working. */
export async function setTagRetired(db: PrismaClient, id: string, retired: boolean, userId: string) {
  return serializable(db, async (tx) => {
    const tag = await activeTag(tx, id)
    if (tag.mergedIntoId) throw new TagManageError('TAG_MERGED', retired ? 'This tag is already merged.' : 'Undo the merge to restore this tag.', 409)
    const updated = await tx.tag.update({ where: { id }, data: { retiredAt: retired ? (tag.retiredAt ?? new Date()) : null }, select: { id: true, retiredAt: true } })
    await audit(tx, retired ? 'tag.retire' : 'tag.restore', id, userId, { name: tag.name })
    return updated
  })
}

// ── Merging ─────────────────────────────────────────────────────────────────────────────────────────

/** What a merge recorded, so it can be undone exactly. Stored as the audit entry's metadata. */
interface MergeRecord {
  targetId: string
  sourceName: string
  targetName: string
  /** Articles that carried the source tag. */
  movedArticleIds: string[]
  /** Of those, the ones that ALREADY carried the target (undo must leave their target link alone). */
  alreadyOnTargetIds: string[]
  movedAliasIds: string[]
  /** Tags previously merged into the source, re-pointed at the target so merges never chain. */
  repointedTagIds: string[]
  sourceRetiredAt: string | null
}

/** How many articles a merge would move, for the confirmation step. */
export async function previewMerge(db: PrismaClient, sourceId: string, targetId: string) {
  const [moving, overlap] = await Promise.all([
    db.articleTag.count({ where: { tagId: sourceId } }),
    db.articleTag.count({ where: { tagId: sourceId, article: { tags: { some: { tagId: targetId } } } } }),
  ])
  return { moving, alreadyOnTarget: overlap }
}

/**
 * Moves every article from `sourceId` to `targetId`, gives the target the source's aliases, and
 * leaves the source as a retired tag pointing at the target: /tag/<source slug> then redirects, and
 * the source's name still resolves to the target when an editor types it.
 */
export async function mergeTags(db: PrismaClient, sourceId: string, targetId: string, userId: string) {
  if (sourceId === targetId) throw new TagManageError('INVALID_MERGE', 'Choose a different tag to merge into.', 400)
  return serializable(db, async (tx) => {
    // Lock both in a fixed order so two opposite merges cannot deadlock or both succeed.
    for (const id of [sourceId, targetId].sort()) await tx.$executeRaw`SELECT id FROM tags WHERE id = ${id} FOR UPDATE`
    const source = await activeTag(tx, sourceId)
    const target = await activeTag(tx, targetId)
    if (source.mergedIntoId) throw new TagManageError('INVALID_MERGE', `“${source.name}” has already been merged.`, 409)
    if (target.mergedIntoId) throw new TagManageError('INVALID_MERGE', `“${target.name}” has been merged into another tag; merge into that one instead.`, 409)
    if (target.retiredAt) throw new TagManageError('INVALID_MERGE', `“${target.name}” is retired. Restore it before merging into it.`, 409)

    const moved = await tx.articleTag.findMany({ where: { tagId: sourceId }, select: { articleId: true } })
    const movedArticleIds = moved.map((m) => m.articleId)
    const already = await tx.articleTag.findMany({ where: { tagId: targetId, articleId: { in: movedArticleIds } }, select: { articleId: true } })
    const alreadyOnTargetIds = already.map((a) => a.articleId)
    const aliases = await tx.tagAlias.findMany({ where: { tagId: sourceId }, select: { id: true } })
    const repointed = await tx.tag.findMany({ where: { mergedIntoId: sourceId }, select: { id: true } })

    if (movedArticleIds.length) {
      await tx.articleTag.createMany({ data: movedArticleIds.map((articleId) => ({ articleId, tagId: targetId })), skipDuplicates: true })
      await tx.articleTag.deleteMany({ where: { tagId: sourceId } })
    }
    await tx.tagAlias.updateMany({ where: { tagId: sourceId }, data: { tagId: targetId } })
    await tx.tag.updateMany({ where: { mergedIntoId: sourceId }, data: { mergedIntoId: targetId } })
    await tx.tag.update({ where: { id: sourceId }, data: { mergedIntoId: targetId, retiredAt: source.retiredAt ?? new Date() } })

    const record: MergeRecord = {
      targetId, sourceName: source.name, targetName: target.name, movedArticleIds, alreadyOnTargetIds,
      movedAliasIds: aliases.map((a) => a.id), repointedTagIds: repointed.map((t) => t.id),
      sourceRetiredAt: source.retiredAt?.toISOString() ?? null,
    }
    await audit(tx, 'tag.merge', sourceId, userId, record as unknown as Prisma.InputJsonValue)
    return { source: { id: source.id, name: source.name, slug: source.slug }, target: { id: target.id, name: target.name, slug: target.slug }, moved: movedArticleIds.length }
  })
}

/**
 * Reverses the most recent merge of `sourceId`, from its audit record: the articles that were moved
 * get the source tag back and lose the target (unless they had it before the merge), and aliases and
 * re-pointed tags return. Articles trashed or deleted since are skipped; links added to the target
 * since the merge are kept.
 */
export async function undoMerge(db: PrismaClient, sourceId: string, userId: string) {
  return serializable(db, async (tx) => {
    await tx.$executeRaw`SELECT id FROM tags WHERE id = ${sourceId} FOR UPDATE`
    const source = await activeTag(tx, sourceId)
    if (!source.mergedIntoId) throw new TagManageError('NOTHING_TO_UNDO', `“${source.name}” is not merged.`, 409)
    const entry = await tx.auditLog.findFirst({ where: { action: 'tag.merge', targetId: sourceId }, orderBy: { createdAt: 'desc' } })
    const record = entry?.metadata as unknown as MergeRecord | undefined
    if (!record || record.targetId !== source.mergedIntoId) {
      throw new TagManageError('NOTHING_TO_UNDO', 'This merge has no record to undo it from. Move its articles back by hand.', 409)
    }
    const stillThere = await tx.article.findMany({ where: { id: { in: record.movedArticleIds } }, select: { id: true } })
    const ids = stillThere.map((a) => a.id)
    if (ids.length) {
      await tx.articleTag.createMany({ data: ids.map((articleId) => ({ articleId, tagId: sourceId })), skipDuplicates: true })
      const keep = new Set(record.alreadyOnTargetIds)
      const removeFromTarget = ids.filter((id) => !keep.has(id))
      if (removeFromTarget.length) await tx.articleTag.deleteMany({ where: { tagId: record.targetId, articleId: { in: removeFromTarget } } })
    }
    await tx.tagAlias.updateMany({ where: { id: { in: record.movedAliasIds }, tagId: record.targetId }, data: { tagId: sourceId } })
    await tx.tag.updateMany({ where: { id: { in: record.repointedTagIds }, mergedIntoId: record.targetId }, data: { mergedIntoId: sourceId } })
    await tx.tag.update({
      where: { id: sourceId },
      data: { mergedIntoId: null, retiredAt: record.sourceRetiredAt ? new Date(record.sourceRetiredAt) : null },
    })
    await audit(tx, 'tag.unmerge', sourceId, userId, { targetId: record.targetId, restoredArticles: ids.length, mergeAuditId: entry!.id })
    return { restored: ids.length }
  })
}

// ── Suggestions ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Records a proposed tag. If the wording already names a tag, nothing is recorded and that tag is
 * returned instead ("a suitable tag already exists"). Suggesting the same wording again is a no-op.
 */
export async function suggestTag(
  db: PrismaClient,
  input: { name: unknown; note?: unknown; articleId?: unknown },
  user: { id: string; role: string },
): Promise<{ existing: { id: string; name: string; slug: string } } | { suggestion: { id: string; name: string } }> {
  const { name, identity } = cleanTagName(input.name)
  const note = cleanDescription(input.note)
  return serializable(db, async (tx) => {
    await lockIdentity(tx, identity)
    const existing = await findTagByWording(tx, identity)
    if (existing) {
      // A merged tag's wording means its target.
      const tag = await tx.tag.findUnique({ where: { id: existing.id }, select: { id: true, name: true, slug: true, mergedInto: { select: { id: true, name: true, slug: true } } } })
      return { existing: tag?.mergedInto ?? { id: existing.id, name: existing.name, slug: existing.slug } }
    }
    // Only link an article the person could be working on: their own, or (for staff above writer) any.
    let articleId: string | null = null
    if (typeof input.articleId === 'string' && input.articleId) {
      const article = await tx.article.findUnique({ where: { id: input.articleId }, select: { id: true, authorId: true, deletedAt: true } })
      if (article && !article.deletedAt && (user.role !== 'WRITER' || article.authorId === user.id)) articleId = article.id
    }
    const pending = await tx.tagSuggestion.findFirst({ where: { identity, suggestedById: user.id, status: 'PENDING' }, select: { id: true, name: true } })
    if (pending) return { suggestion: pending }
    const suggestion = await tx.tagSuggestion.create({ data: { name, identity, note, articleId, suggestedById: user.id }, select: { id: true, name: true } })
    return { suggestion }
  })
}

export type SuggestionDecision =
  | { action: 'approve'; name?: unknown }
  | { action: 'alias'; tagId: string }
  | { action: 'reject'; reason?: unknown }

/**
 * Decides a suggestion, and every other pending suggestion of the same wording with it, and tells
 * each person who suggested it. Approving creates the tag (optionally under a corrected name);
 * "alias" records the wording as another name of an existing tag.
 */
export async function reviewSuggestion(db: PrismaClient, id: string, decision: SuggestionDecision, reviewerId: string) {
  return serializable(db, async (tx) => {
    const suggestion = await tx.tagSuggestion.findUnique({ where: { id } })
    if (!suggestion) throw new TagManageError('NOT_FOUND', 'That suggestion no longer exists.', 404)
    if (suggestion.status !== 'PENDING') throw new TagManageError('ALREADY_REVIEWED', 'This suggestion has already been reviewed.', 409)
    await lockIdentity(tx, suggestion.identity)

    let tag: { id: string; name: string; slug: string } | null = null
    let status: 'APPROVED' | 'MERGED' | 'REJECTED'
    if (decision.action === 'approve') {
      const { name, identity } = cleanTagName(decision.name ?? suggestion.name)
      if (identity !== suggestion.identity) await lockIdentity(tx, identity)
      await assertWordingFree(tx, identity, name)
      const [topic] = normalizeArticleTags([name])
      tag = await tx.tag.findUniqueOrThrow({ where: { id: (await resolveArticleTag(tx, topic)).id }, select: { id: true, name: true, slug: true } })
      // A corrected spelling keeps the suggested wording findable.
      if (identity !== suggestion.identity && !(await findTagByWording(tx, suggestion.identity))) {
        await tx.tagAlias.create({ data: { tagId: tag.id, name: suggestion.name, identity: suggestion.identity, createdById: reviewerId } })
      }
      await audit(tx, 'tag.create', tag.id, reviewerId, { name: tag.name, slug: tag.slug, fromSuggestion: id })
      status = 'APPROVED'
    } else if (decision.action === 'alias') {
      const target = await activeTag(tx, decision.tagId)
      if (target.mergedIntoId || target.retiredAt) throw new TagManageError('INVALID_MERGE', `Choose an active tag; “${target.name}” is ${target.mergedIntoId ? 'merged' : 'retired'}.`, 409)
      await assertWordingFree(tx, suggestion.identity, suggestion.name)
      await tx.tagAlias.create({ data: { tagId: target.id, name: suggestion.name, identity: suggestion.identity, createdById: reviewerId } })
      await audit(tx, 'tag.alias.add', target.id, reviewerId, { alias: suggestion.name, fromSuggestion: id })
      tag = { id: target.id, name: target.name, slug: target.slug }
      status = 'MERGED'
    } else {
      status = 'REJECTED'
    }

    const decided = await tx.tagSuggestion.findMany({ where: { identity: suggestion.identity, status: 'PENDING' }, select: { id: true, suggestedById: true } })
    await tx.tagSuggestion.updateMany({
      where: { id: { in: decided.map((d) => d.id) } },
      data: { status, resolvedTagId: tag?.id ?? null, reviewedById: reviewerId, reviewedAt: new Date() },
    })
    const reason = decision.action === 'reject' && typeof decision.reason === 'string' ? decision.reason.trim().slice(0, 300) : ''
    const message =
      status === 'REJECTED'
        ? `“${suggestion.name}” was not added as a tag.${reason ? ` ${reason}` : ''}`
        : status === 'APPROVED'
          ? `“${tag!.name}” is now an approved tag. You can choose it in the article editor.`
          : `“${suggestion.name}” now finds the existing tag “${tag!.name}”. Choose that tag in the article editor.`
    const people = [...new Set(decided.map((d) => d.suggestedById))].filter((userId) => userId !== reviewerId)
    if (people.length) {
      await tx.notification.createMany({
        data: people.map((userId) => ({
          userId,
          type: 'tag_suggestion',
          title: status === 'REJECTED' ? 'Tag suggestion declined' : 'Tag suggestion approved',
          message,
          articleId: suggestion.articleId,
        })),
      })
    }
    return { status, tag, decided: decided.length }
  })
}

/** Maps a TagManageError, or a database refusal of a duplicate wording, to an HTTP answer. */
export function tagErrorBody(error: unknown): { status: number; body: { error: string; code: string; existing?: { id: string; name: string; slug: string } } } | null {
  if (error instanceof TagManageError) {
    return { status: error.status, body: { error: error.message, code: error.code, ...(error.existing ? { existing: error.existing } : {}) } }
  }
  // The database's own uniqueness guards (a race the advisory lock did not cover).
  const text = error instanceof Error ? error.message : ''
  if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || /TAG_ALIAS_CONFLICT|tags_canonical_identity_key|tag_aliases_identity_key/.test(text)) {
    return { status: 409, body: { error: 'That name is already used by another tag or alias.', code: 'NAME_TAKEN' } }
  }
  return null
}
