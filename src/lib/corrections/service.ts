import { Prisma, type ArticleCorrection, type Role } from '@prisma/client'
import type { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { articleVersion } from '@/lib/articleVersion'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { editorCanAccessCategory } from '@/lib/articleCategoryScope'
import { ArticleImageUnavailableError, cleanupRemovedArticleImages, lockArticleImages } from '@/lib/articleImageStorage'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { ARTICLE_MUTATION_ROLES, CORRECTION_APPROVAL_ROLES, CORRECTION_PREPARE_ROLES, isAllowedRole } from '@/lib/rbac'
import { composeLegacyMirror } from './format'
import { withTransactionRetry } from '@/lib/transactionRetry'
import { ARTICLE_SAVE_TIMEOUT_MS } from '@/lib/articleTags'
import { CORRECTION_TYPE_LABELS, type CorrectionErrorCode, type CorrectionText } from './types'
import { textChanged, type CorrectionDraftInput } from './validation'

/**
 * Post-publication corrections: the only code that changes a published article's reader-facing
 * text together with a public notice.
 *
 * Guarantees (each is exercised against real PostgreSQL in tests/integration/corrections-db.test.ts):
 *   - Atomic: the article amendment, the PUBLISHED correction row and the audit entry commit in one
 *     transaction, or none of them does.
 *   - Serialised per article: the article row is locked (SELECT ... FOR UPDATE) and the amendment is
 *     applied only if the article still matches the version the editor prepared it from, so two
 *     editors (or a stale tab) can never overwrite each other or publish two notices for one change.
 *   - Idempotent: every submission carries a client key (requestKey, unique in the database); a
 *     replay or double click returns the first result instead of creating a second record.
 *   - Only PUBLISHED, non-trashed articles can be corrected; status, publication date, slug, schedule,
 *     featured/pinned flags and counters are never written.
 *   - Identities and timestamps come from the session and the server clock, never the request.
 *   - Published records are permanent: enforced here and by trigger article_corrections_protect.
 *   - Notifications and cache refresh run after the commit; their failure is reported as a warning,
 *     never as a failed correction.
 */

export class CorrectionError extends Error {
  constructor(public readonly code: CorrectionErrorCode, public readonly status: number, message: string) {
    super(message)
    this.name = 'CorrectionError'
  }
}

export interface CorrectionActor {
  id: string
  role: Role
  name: string | null
}

/** The application client (its `omit` configuration is part of the type). */
type Db = typeof prisma
type Tx = Prisma.TransactionClient
// Same bound as an article save: a correction may wait briefly for a concurrent save's row lock.
const TX_OPTIONS = { timeout: ARTICLE_SAVE_TIMEOUT_MS }

const ARTICLE_FOR_CORRECTION = {
  id: true, title: true, slug: true, content: true, excerpt: true, coverImage: true, categoryId: true,
  authorId: true, status: true, scheduledAt: true, deletedAt: true, publishedAt: true, updatedAt: true,
  author: { select: { name: true } },
  tags: { select: { tag: { select: { name: true } } } },
} satisfies Prisma.ArticleSelect

type LoadedArticle = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_FOR_CORRECTION }>

export function currentArticleVersion(article: LoadedArticle): string {
  return articleVersion(article, article.tags.map((t) => t.tag.name))
}

function textOf(article: Pick<LoadedArticle, 'title' | 'excerpt' | 'content' | 'coverImage' | 'authorId' | 'author'>): CorrectionText {
  return {
    title: article.title, excerpt: article.excerpt, content: article.content,
    coverImage: article.coverImage, authorId: article.authorId, authorName: article.author.name,
  }
}

export function parseStoredText(value: Prisma.JsonValue | null): CorrectionText | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.title !== 'string' || typeof v.content !== 'string') return null
  return {
    title: v.title, content: v.content, excerpt: typeof v.excerpt === 'string' ? v.excerpt : null,
    ...('coverImage' in v ? { coverImage: typeof v.coverImage === 'string' ? v.coverImage : null } : {}),
    ...(typeof v.authorId === 'string' ? { authorId: v.authorId } : {}),
    ...(typeof v.authorName === 'string' ? { authorName: v.authorName } : {}),
  }
}

const toJson = (text: CorrectionText): Prisma.InputJsonValue => ({
  title: text.title, excerpt: text.excerpt, content: text.content,
  ...(text.coverImage !== undefined ? { coverImage: text.coverImage } : {}),
  ...(text.authorId !== undefined ? { authorId: text.authorId, authorName: text.authorName ?? null } : {}),
})

/** A byline may name only an active, unbanned account that can author articles. Returns the name snapshot. */
async function assertValidAuthor(tx: Tx, text: CorrectionText): Promise<CorrectionText> {
  if (text.authorId === undefined) return text
  const author = await tx.user.findUnique({ where: { id: text.authorId }, select: { name: true, role: true, isActive: true, isBanned: true } })
  if (!author || !author.isActive || author.isBanned || !isAllowedRole(author.role, ARTICLE_MUTATION_ROLES)) {
    throw new CorrectionError('INVALID_AUTHOR', 400, 'The byline must name an active writer, editor or administrator.')
  }
  return { ...text, authorName: author.name }
}

// ── Access ───────────────────────────────────────────────────────────────────────────────────────

export function canApproveCorrections(role: Role): boolean {
  return isAllowedRole(role, CORRECTION_APPROVAL_ROLES)
}

async function assertCanPrepare(actor: CorrectionActor, categoryId: string | null): Promise<void> {
  if (!isAllowedRole(actor.role, CORRECTION_PREPARE_ROLES)) {
    throw new CorrectionError('FORBIDDEN', 403, 'Only editors and administrators can prepare corrections.')
  }
  if (actor.role === 'EDITOR') {
    const scope = await loadEditorCategoryScope(actor.id)
    if (!editorCanAccessCategory(scope, categoryId)) {
      throw new CorrectionError('CATEGORY_SCOPE_DENIED', 403, 'This article is outside your assigned categories.')
    }
  }
}

function assertCanApprove(actor: CorrectionActor): void {
  if (!canApproveCorrections(actor.role)) {
    throw new CorrectionError(
      'FORBIDDEN', 403,
      'Publishing a correction needs approval from a senior editor (an administrator). Submit it for approval instead.',
    )
  }
}

function assertCorrectable(article: LoadedArticle | null): asserts article is LoadedArticle {
  if (!article || article.deletedAt) throw new CorrectionError('NOT_FOUND', 404, 'This article no longer exists.')
  if (article.status !== 'PUBLISHED') {
    throw new CorrectionError(
      'ARTICLE_NOT_PUBLISHED', 409,
      `Only a published article can be corrected; this one is ${article.status.toLowerCase().replace('_', ' ')}. ` +
      'Edit unpublished articles in the article editor.',
    )
  }
}

/** Locks the article row for the rest of the transaction, then reads it. */
async function lockArticle(tx: Tx, articleId: string): Promise<LoadedArticle | null> {
  await tx.$queryRaw`SELECT id FROM articles WHERE id = ${articleId} FOR UPDATE`
  return tx.article.findUnique({ where: { id: articleId }, select: ARTICLE_FOR_CORRECTION })
}

function assertVersion(article: LoadedArticle, baseVersion: string, pending = false): void {
  if (currentArticleVersion(article) !== baseVersion) {
    throw new CorrectionError(
      'ARTICLE_CHANGED', 409,
      pending
        ? 'The article has changed since this correction was prepared, so it cannot be published as it stands. ' +
          'Open the correction, review it against the current article and save it again.'
        : 'The article was changed in another tab or by another editor since you opened it. Nothing was saved. ' +
          'Copy your notes, reload, and prepare the correction against the current text.',
    )
  }
}

// ── Prepare / publish ────────────────────────────────────────────────────────────────────────────

export interface CorrectionResult {
  correction: ArticleCorrection
  /** True when this request was a replay of one already processed (same key, same editor). */
  replayed: boolean
  published: boolean
  article: { id: string; slug: string; authorId: string; title: string }
  /** Set when the article text changed, so removed images can be released after the commit. */
  replacedText?: { before: CorrectionText & { coverImage: string | null }; after: CorrectionText & { coverImage: string | null } }
}

async function replayFor(db: Db, requestKey: string, actor: CorrectionActor, articleId: string): Promise<CorrectionResult | null> {
  const existing = await db.articleCorrection.findUnique({ where: { requestKey } })
  if (!existing) return null
  if (existing.createdById !== actor.id || existing.articleId !== articleId) {
    throw new CorrectionError('DUPLICATE_REQUEST', 409, 'This submission key has already been used. Reload the page and try again.')
  }
  const article = await db.article.findUniqueOrThrow({ where: { id: articleId }, select: { id: true, slug: true, authorId: true, title: true } })
  return { correction: existing, replayed: true, published: existing.status === 'PUBLISHED', article }
}

function isUniqueViolation(error: unknown, target: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  return JSON.stringify(error.meta ?? {}).includes(target)
}

/**
 * Prepare a correction against the article version the editor was looking at. With `publishNow`
 * (approval roles only) it is published in the same transaction; otherwise it waits as PENDING.
 */
export async function prepareCorrection(
  db: Db,
  actor: CorrectionActor,
  articleId: string,
  input: CorrectionDraftInput,
  options: { requestKey: string; publishNow: boolean; requestId: string },
): Promise<CorrectionResult> {
  const replay = await replayFor(db, options.requestKey, actor, articleId)
  if (replay) return replay

  const preview = await db.article.findUnique({ where: { id: articleId }, select: ARTICLE_FOR_CORRECTION })
  if (!preview || preview.deletedAt) throw new CorrectionError('NOT_FOUND', 404, 'This article no longer exists.')
  await assertCanPrepare(actor, preview.categoryId)
  if (options.publishNow) assertCanApprove(actor)

  try {
    return await withTransactionRetry('corrections:prepare', () => db.$transaction(async (tx) => {
      const article = await lockArticle(tx, articleId)
      // A duplicate of this request that held the lock first has committed by now: answer with its result
      // rather than reporting the change it made as a conflict.
      const duplicate = await tx.articleCorrection.findUnique({ where: { requestKey: options.requestKey } })
      if (duplicate && article) {
        if (duplicate.createdById !== actor.id || duplicate.articleId !== articleId) {
          throw new CorrectionError('DUPLICATE_REQUEST', 409, 'This submission key has already been used. Reload the page and try again.')
        }
        return { correction: duplicate, replayed: true, published: duplicate.status === 'PUBLISHED', article: pick(article) }
      }
      assertCorrectable(article)
      // The category may have moved between the access check and the lock.
      if (article.categoryId !== preview.categoryId) await assertCanPrepare(actor, article.categoryId)
      assertVersion(article, input.baseVersion)

      const pending = await tx.articleCorrection.findFirst({ where: { articleId, status: 'PENDING' }, select: { createdByName: true } })
      if (pending) {
        throw new CorrectionError(
          'PENDING_CORRECTION_EXISTS', 409,
          `A correction prepared by ${pending.createdByName ?? 'another editor'} is already awaiting approval for this article. ` +
          'Review, publish or withdraw it first.',
        )
      }

      if (input.supersedesId) {
        const target = await tx.articleCorrection.findUnique({
          where: { id: input.supersedesId },
          include: { supersededBy: { where: { status: { not: 'WITHDRAWN' } }, select: { id: true } } },
        })
        if (!target || target.articleId !== articleId || target.status !== 'PUBLISHED') {
          throw new CorrectionError('VALIDATION_ERROR', 400, 'Only a published notice on this article can be amended.')
        }
        if (target.supersededBy.length > 0) {
          throw new CorrectionError('CORRECTION_ALREADY_AMENDED', 409, 'That notice has already been amended. Amend the latest notice instead.')
        }
      } else if (input.type === 'CORRECTION' && !textChanged(textOf(article), input.text)) {
        throw new CorrectionError(
          'NO_TEXT_CHANGE', 400,
          'A correction must amend the article itself. Change the incorrect passage in the article text, ' +
          'or choose clarification or update if the text is to stay as it is.',
        )
      }

      const text = await assertValidAuthor(tx, input.text)
      const created = await tx.articleCorrection.create({
        data: {
          articleId,
          type: input.type,
          status: 'PENDING',
          publicNote: input.publicNote,
          originalText: input.originalText,
          correctedText: input.correctedText,
          internalNote: input.internalNote,
          baseVersion: input.baseVersion,
          proposed: toJson(text),
          supersedesId: input.supersedesId,
          requestKey: options.requestKey,
          createdById: actor.id,
          createdByName: actor.name,
        },
      })
      await tx.auditLog.create({
        data: {
          action: 'correction.prepared', targetType: 'article', targetId: articleId, performedBy: actor.id,
          metadata: { correctionId: created.id, type: input.type, publishNow: options.publishNow, requestId: options.requestId },
        },
      })

      if (!options.publishNow) {
        return { correction: created, replayed: false, published: false, article: pick(article) }
      }
      return applyCorrection(tx, actor, article, created, text, options.requestId)
    }, TX_OPTIONS))
  } catch (error) {
    // A concurrent duplicate of this very request committed first: answer with its result.
    if (isUniqueViolation(error, 'requestKey')) {
      const again = await replayFor(db, options.requestKey, actor, articleId)
      if (again) return again
    }
    if (isUniqueViolation(error, 'one_pending_per_article') || isUniqueViolation(error, 'articleId')) {
      throw new CorrectionError('PENDING_CORRECTION_EXISTS', 409, 'Another correction for this article was submitted at the same moment. Reload to review it.')
    }
    if (isUniqueViolation(error, 'supersedesId') || isUniqueViolation(error, 'one_amendment_per_notice')) {
      throw new CorrectionError('CORRECTION_ALREADY_AMENDED', 409, 'That notice was amended by someone else at the same moment. Reload to see it.')
    }
    if (error instanceof ArticleImageUnavailableError) throw new CorrectionError('IMAGE_UNAVAILABLE', 400, error.message)
    throw error
  }
}

/** Publish a PENDING correction exactly as it was prepared (approval roles only). */
export async function publishPendingCorrection(
  db: Db,
  actor: CorrectionActor,
  correctionId: string,
  options: { expectedUpdatedAt: Date; requestId: string },
): Promise<CorrectionResult> {
  assertCanApprove(actor)
  const preview = await db.articleCorrection.findUnique({ where: { id: correctionId }, select: { articleId: true } })
  if (!preview) throw new CorrectionError('NOT_FOUND', 404, 'This correction no longer exists.')

  try {
    return await withTransactionRetry('corrections:publish', () => db.$transaction(async (tx) => {
      const article = await lockArticle(tx, preview.articleId)
      assertCorrectable(article)
      await assertCanPrepare(actor, article.categoryId)
      const correction = await tx.articleCorrection.findUniqueOrThrow({ where: { id: correctionId } })
      if (correction.status !== 'PENDING') {
        throw new CorrectionError('CORRECTION_NOT_PENDING', 409, `This correction has already been ${correction.status.toLowerCase()}. Reload to see its current state.`)
      }
      if (correction.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
        throw new CorrectionError('CORRECTION_CHANGED', 409, 'This correction was revised after you opened it. Reload and review the latest version before publishing.')
      }
      const text = parseStoredText(correction.proposed)
      if (!text || !correction.baseVersion) throw new CorrectionError('VALIDATION_ERROR', 400, 'This correction has no prepared article text.')
      assertVersion(article, correction.baseVersion, true)
      return applyCorrection(tx, actor, article, correction, await assertValidAuthor(tx, text), options.requestId)
    }, TX_OPTIONS))
  } catch (error) {
    if (error instanceof ArticleImageUnavailableError) throw new CorrectionError('IMAGE_UNAVAILABLE', 400, error.message)
    throw error
  }
}

function pick(article: LoadedArticle) {
  return { id: article.id, slug: article.slug, authorId: article.authorId, title: article.title }
}

/**
 * Inside the caller's transaction, with the article row locked and its version verified: amend the
 * reader-facing text, publish the record and audit it. Nothing else on the article is written.
 */
async function applyCorrection(
  tx: Tx,
  actor: CorrectionActor,
  article: LoadedArticle,
  correction: ArticleCorrection,
  text: CorrectionText,
  requestId: string,
): Promise<CorrectionResult> {
  const before = textOf(article)
  const changed = textChanged(before, text)
  const nextCover = text.coverImage !== undefined ? text.coverImage : article.coverImage
  if (changed) await lockArticleImages(tx, text.content, nextCover)

  const updatedArticle = await tx.article.update({
    where: { id: article.id, status: 'PUBLISHED', deletedAt: null },
    data: changed ? {
      title: text.title, excerpt: text.excerpt, content: text.content,
      ...(text.coverImage !== undefined ? { coverImage: text.coverImage } : {}),
      ...(text.authorId !== undefined ? { authorId: text.authorId } : {}),
    } : {},
    select: { id: true, slug: true, authorId: true, title: true },
  })

  const now = new Date()
  const published = await tx.articleCorrection.update({
    where: { id: correction.id, status: 'PENDING' },
    data: {
      status: 'PUBLISHED',
      publishedAt: now,
      approvedById: actor.id,
      approvedByName: actor.name,
      previous: toJson(before),
      proposed: toJson(text),
    },
  })
  await mirrorLegacyFields(tx, article.id)
  await tx.auditLog.create({
    data: {
      action: 'correction.published', targetType: 'article', targetId: article.id, performedBy: actor.id,
      metadata: {
        correctionId: correction.id, type: correction.type, textChanged: changed,
        preparedBy: correction.createdById, supersedesId: correction.supersedesId, requestId,
      },
    },
  })

  return {
    correction: published,
    replayed: false,
    published: true,
    article: updatedArticle,
    ...(changed ? {
      replacedText: {
        before: { ...before, coverImage: article.coverImage },
        after: { ...text, coverImage: nextCover },
      },
    } : {}),
  }
}

/**
 * Keeps the legacy single-note columns describing EVERY published notice, so that if the previous build is
 * restored (it reads only these columns) no clarification or update silently disappears. See composeLegacyMirror.
 */
async function mirrorLegacyFields(tx: Tx, articleId: string): Promise<void> {
  const notices = await tx.articleCorrection.findMany({
    where: { articleId, status: 'PUBLISHED' },
    select: { type: true, publicNote: true, publishedAt: true },
    orderBy: [{ publishedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
  })
  await tx.article.update({
    where: { id: articleId },
    data: { corrected: notices.length > 0, correctionNote: composeLegacyMirror(notices) },
  })
}

// ── Revise / withdraw a pending correction ───────────────────────────────────────────────────────

async function loadPendingForChange(tx: Tx, actor: CorrectionActor, correctionId: string, expectedUpdatedAt: Date) {
  const correction = await tx.articleCorrection.findUnique({ where: { id: correctionId } })
  if (!correction) throw new CorrectionError('NOT_FOUND', 404, 'This correction no longer exists.')
  const article = await tx.article.findUnique({ where: { id: correction.articleId }, select: { categoryId: true } })
  await assertCanPrepare(actor, article?.categoryId ?? null)
  if (correction.createdById !== actor.id && !canApproveCorrections(actor.role)) {
    throw new CorrectionError('FORBIDDEN', 403, 'Only the editor who prepared this correction, or an administrator, can change it.')
  }
  if (correction.status !== 'PENDING') {
    throw new CorrectionError('CORRECTION_NOT_PENDING', 409, `This correction has already been ${correction.status.toLowerCase()} and can no longer be changed.`)
  }
  if (correction.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new CorrectionError('CORRECTION_CHANGED', 409, 'This correction was changed after you opened it. Reload to see the latest version.')
  }
  return correction
}

export async function revisePendingCorrection(
  db: Db,
  actor: CorrectionActor,
  correctionId: string,
  input: CorrectionDraftInput,
  options: { expectedUpdatedAt: Date; requestId: string },
): Promise<ArticleCorrection> {
  return withTransactionRetry('corrections:revise', () => db.$transaction(async (tx) => {
    const correction = await loadPendingForChange(tx, actor, correctionId, options.expectedUpdatedAt)
    const article = await lockArticle(tx, correction.articleId)
    assertCorrectable(article)
    assertVersion(article, input.baseVersion)
    if (input.supersedesId !== correction.supersedesId) {
      throw new CorrectionError('VALIDATION_ERROR', 400, 'An amendment cannot be switched to a different notice. Withdraw it and start again.')
    }
    if (!input.supersedesId && input.type === 'CORRECTION' && !textChanged(textOf(article), input.text)) {
      throw new CorrectionError('NO_TEXT_CHANGE', 400, 'A correction must amend the article itself. Change the incorrect passage in the article text.')
    }
    const updated = await tx.articleCorrection.update({
      where: { id: correctionId, status: 'PENDING', updatedAt: correction.updatedAt },
      data: {
        type: input.type, publicNote: input.publicNote, originalText: input.originalText,
        correctedText: input.correctedText, internalNote: input.internalNote,
        baseVersion: input.baseVersion, proposed: toJson(await assertValidAuthor(tx, input.text)),
      },
    })
    await tx.auditLog.create({
      data: { action: 'correction.revised', targetType: 'article', targetId: correction.articleId, performedBy: actor.id, metadata: { correctionId, requestId: options.requestId } },
    })
    return updated
  }, TX_OPTIONS))
}

export async function withdrawPendingCorrection(
  db: Db,
  actor: CorrectionActor,
  correctionId: string,
  reason: string,
  options: { expectedUpdatedAt: Date; requestId: string },
): Promise<ArticleCorrection> {
  return withTransactionRetry('corrections:withdraw', () => db.$transaction(async (tx) => {
    const correction = await loadPendingForChange(tx, actor, correctionId, options.expectedUpdatedAt)
    const updated = await tx.articleCorrection.update({
      where: { id: correctionId, status: 'PENDING', updatedAt: correction.updatedAt },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnById: actor.id, withdrawnReason: reason },
    })
    await tx.auditLog.create({
      data: { action: 'correction.withdrawn', targetType: 'article', targetId: correction.articleId, performedBy: actor.id, metadata: { correctionId, requestId: options.requestId } },
    })
    return updated
  }, TX_OPTIONS))
}

// ── After the commit ─────────────────────────────────────────────────────────────────────────────

export interface PostCommitWarning {
  stage: 'cache' | 'notification' | 'images'
  message: string
}

/**
 * Best-effort follow-up once a correction is committed. Never throws: each failure becomes a warning
 * the editor is shown next to the (successful) result.
 *
 * Deliberately NOT done: no email, no newsletter, no "article published" notification, no
 * achievement, no change to publication date, feed position or scheduling.
 */
export async function afterCorrectionPublished(db: Db, actor: CorrectionActor, result: CorrectionResult): Promise<PostCommitWarning[]> {
  const warnings: PostCommitWarning[] = []
  if (!result.published || result.replayed) return warnings

  try {
    // Lists, the RSS feed and the sitemap share this tag (the sitemap's lastmod moves forward).
    // Queue the article path first: the awaited list expiry writes both before the response is sent.
    revalidatePath(`/articles/${result.article.slug}`)
    if (!(await revalidateArticleLists())) throw new Error('list revalidation failed')
  } catch (error) {
    console.error('[corrections:revalidate]', error)
    warnings.push({ stage: 'cache', message: 'The correction is live, but some cached pages may take up to a minute to show it.' })
  }

  if (result.replacedText) {
    try {
      await cleanupRemovedArticleImages(
        result.replacedText.before.content, result.replacedText.before.coverImage,
        result.replacedText.after.content, result.replacedText.after.coverImage,
      )
    } catch (error) {
      console.error('[corrections:images]', error)
      warnings.push({ stage: 'images', message: 'An image removed by this correction could not be released; it will be cleaned up later.' })
    }
  }

  const label = CORRECTION_TYPE_LABELS[result.correction.type].toLowerCase()
  // Includes the previous author when the correction changed the byline.
  const recipients = new Set([result.article.authorId, result.replacedText?.before.authorId, result.correction.createdById].filter((id): id is string => Boolean(id)))
  recipients.delete(actor.id)
  if (recipients.size > 0) {
    try {
      await db.notification.createMany({
        data: [...recipients].map((userId) => ({
          userId,
          type: 'correction_published',
          title: `A ${label} was published`,
          message: `A ${label} notice was added to "${result.article.title}".`,
          articleId: result.article.id,
        })),
      })
    } catch (error) {
      console.error('[corrections:notify]', error)
      warnings.push({ stage: 'notification', message: 'The correction is live, but the author could not be notified. Let them know directly.' })
    }
  }
  return warnings
}

/** Tell the approvers that a correction is waiting. Best effort, after the commit. */
export async function afterCorrectionSubmitted(db: Db, actor: CorrectionActor, result: CorrectionResult): Promise<PostCommitWarning[]> {
  if (result.published || result.replayed) return []
  try {
    const approvers = await db.user.findMany({
      where: { role: { in: [...CORRECTION_APPROVAL_ROLES] }, isActive: true, isBanned: false, id: { not: actor.id } },
      select: { id: true },
    })
    if (approvers.length > 0) {
      await db.notification.createMany({
        data: approvers.map((approver) => ({
          userId: approver.id,
          type: 'correction_submitted',
          title: 'Correction awaiting approval',
          message: `${actor.name ?? 'An editor'} submitted a ${CORRECTION_TYPE_LABELS[result.correction.type].toLowerCase()} for "${result.article.title}".`,
          articleId: result.article.id,
        })),
      })
    }
    return []
  } catch (error) {
    console.error('[corrections:notify-approvers]', error)
    return [{ stage: 'notification', message: 'The correction was submitted, but administrators could not be notified. Let them know directly.' }]
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

/** Everything the Manage Corrections page shows. Staff only; scope is checked by the caller. */
export async function loadCorrectionHistory(db: Db, articleId: string) {
  const [corrections, copyEdits] = await Promise.all([
    db.articleCorrection.findMany({ where: { articleId }, orderBy: [{ createdAt: 'asc' }] }),
    db.auditLog.findMany({
      where: { targetId: articleId, targetType: 'article', action: 'article.copy_edit' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, performedBy: true, metadata: true },
    }),
  ])
  const userIds = [...new Set(copyEdits.map((c) => c.performedBy))]
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const names = new Map(users.map((u) => [u.id, u.name]))
  return {
    corrections,
    copyEdits: copyEdits.map((c) => {
      const meta = (c.metadata ?? {}) as Record<string, unknown>
      return {
        id: c.id,
        createdAt: c.createdAt,
        editorName: names.get(c.performedBy) ?? 'Former staff member',
        fields: Array.isArray(meta.fields) ? (meta.fields as string[]) : [],
      }
    }),
  }
}

/** Accounts a byline may name (active, unbanned writers, editors and administrators). */
export async function loadAuthorOptions(db: Db) {
  return db.user.findMany({
    where: { role: { in: [...ARTICLE_MUTATION_ROLES] }, isActive: true, isBanned: false },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  })
}

export async function loadArticleForCorrections(db: Db, actor: CorrectionActor, articleId: string) {
  const article = await db.article.findUnique({ where: { id: articleId }, select: ARTICLE_FOR_CORRECTION })
  if (!article || article.deletedAt) throw new CorrectionError('NOT_FOUND', 404, 'This article no longer exists.')
  await assertCanPrepare(actor, article.categoryId)
  return { article, version: currentArticleVersion(article) }
}
