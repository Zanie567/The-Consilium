import { articleRevisionError } from '@/lib/articleRevision'
import { isHiddenDebateViolation, hiddenDebateResponse } from '@/lib/hiddenDebateGuard'
import { figureAltError } from '@/lib/figureValidation'
import { ArticleImageUnavailableError, lockArticleImages, cleanupRemovedArticleImages } from '@/lib/articleImageStorage'
import { resolveArticleTag } from '@/lib/resolveArticleTag'
import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse, NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession, requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, articleSubmittedEmail } from '@/lib/email'
import { parseEditorialScheduleInput } from '@/lib/editorialSchedule'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { PUBLIC_AUTHOR_SELECT } from '@/lib/publicUser'
import { toPublicArticle } from '@/lib/publicArticle'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { editorCanAccessCategory } from '@/lib/articleCategoryScope'
import { apiError, articleMutationErrorResponse } from '@/lib/apiResponse'
import { ARTICLE_SAVE_TIMEOUT_MS, normalizeArticleTags } from '@/lib/articleTags'
import { articleVersion } from '@/lib/articleVersion'
import { withTransactionRetry } from '@/lib/transactionRetry'
import { finalSlugForTransition, isProvisionalSlug, isSlugAvailable, isSlugLocked, slugLockFor, uniqueProvisionalSlug, validateCustomSlug } from '@/lib/articleSlug'
import type { ArticleStatus } from '@prisma/client'

// Reader-facing fields of a live article that change only through a declared copy edit (audited) or a
// correction. Slug and byline are stricter: the slug is locked once the article has ever been published, the
// byline while it is published (see the PUT handler).
const PUBLISHED_TEXT_FIELDS = ['title', 'excerpt', 'content', 'coverImage'] as const
type PublishedTextField = (typeof PUBLISHED_TEXT_FIELDS)[number]

/** Which reader-facing fields a save would change (excerpt and cover image: empty and null are the same). */
function publishedTextChanges(
  existing: Record<PublishedTextField, string | null>,
  next: Partial<Record<PublishedTextField, unknown>>
): PublishedTextField[] {
  return PUBLISHED_TEXT_FIELDS.filter((field) => {
    const value = next[field]
    if (value === undefined) return false
    if (field === 'excerpt' || field === 'coverImage') return ((value as string | null) || '') !== (existing[field] || '')
    return value !== existing[field]
  })
}

const STAFF_ARTICLE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED', 'SCHEDULED'] as const satisfies readonly ArticleStatus[]
const WRITER_UPDATE_STATUSES = ['DRAFT', 'PENDING_REVIEW'] as const satisfies readonly ArticleStatus[]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const session = await getServerSession(authOptions)

    if (session?.user.role === 'GROWTH') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        // Safe author fields only: this object is returned to anonymous callers
        // for published articles and to the author for their own articles.
        author: { select: PUBLIC_AUTHOR_SELECT },
        category: true,
        series: true,
        tags: { include: { tag: true } },
      },
    })
    if (!article || article.deletedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isOwner = session?.user?.id === article.authorId
    const isAdmin = session?.user?.role === 'ADMIN'
    const isEditor = session?.user?.role === 'EDITOR'
    const isEditorial = isAdmin || isEditor

    if (article.status === 'PUBLISHED' && !isOwner && !isEditorial) {
      // Visitors get the site's own visibility rule (which also hides an article of an
      // unpublished or deleted debate) and an explicit column allowlist, so editorial notes,
      // scores, schedule times and future internal columns never reach a public response.
      const isPublic = await prisma.article.count({ where: publishedArticleWhere({ id }) })
      if (!isPublic) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(toPublicArticle(article, ['author', 'category', 'series', 'tags']))
    }

    const authError = requireActiveSession(session)
    if (authError) return authError

    if (!isOwner && !isEditorial) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (isEditor) {
      const scope = await loadEditorCategoryScope(session!.user.id)
      if (!editorCanAccessCategory(scope, article.categoryId)) {
        return apiError(
          'This article is outside your assigned categories.',
          403,
          'CATEGORY_SCOPE_DENIED'
        )
      }
    }

    if (!isEditorial) {
      return NextResponse.json({ ...article, version: articleVersion(article, article.tags.map(t => t.tag.name)) })
    }

    const articleWithNotes = await prisma.article.findUnique({
      where: { id },
      include: {
        author: { select: PUBLIC_AUTHOR_SELECT },
        category: true,
        notes: { include: { author: { select: PUBLIC_AUTHOR_SELECT } }, orderBy: { createdAt: 'asc' } },
        series: true,
        tags: { include: { tag: true } },
      },
    })

    if (!articleWithNotes || articleWithNotes.deletedAt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Return only the snapshot whose category access was checked above.
    if (articleWithNotes.updatedAt.getTime() !== article.updatedAt.getTime()) {
      return apiError('This article changed while loading. Please reload it.', 409, 'ARTICLE_CHANGED')
    }
    return NextResponse.json({
      ...articleWithNotes,
      version: articleVersion(articleWithNotes, articleWithNotes.tags.map(t => t.tag.name)),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch article' }, { status: 500 })
  }
}

async function PUTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID()

  try {
    const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
    if (!auth.ok) return auth.response
    const user = auth.user
    const { id } = await params
    const isAdminOrEditor = user.role === 'ADMIN' || user.role === 'EDITOR'

    const existing = await prisma.article.findUnique({
      where: { id },
      include: { author: true, category: true, tags: { include: { tag: true } } },
    })
    if (!existing || existing.deletedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Writers can only edit their own articles
    if (!isAdminOrEditor && existing.authorId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Writers cannot edit articles that are pending/published (unless editor returned them)
    if (
      !isAdminOrEditor &&
      existing.status !== 'DRAFT' &&
      existing.status !== 'REJECTED'
    ) {
      return NextResponse.json(
        { error: 'Article cannot be edited in its current state.' },
        { status: 400 }
      )
    }

    const body = await request.json()
    if (body.expectedUpdatedAt !== undefined) {
      const revision = typeof body.expectedUpdatedAt === 'string' ? new Date(body.expectedUpdatedAt) : null
      if (!revision || !Number.isFinite(revision.getTime())) {
        return apiError('The article revision is invalid.', 400, 'VALIDATION_ERROR', requestId)
      }
      if (revision.getTime() !== existing.updatedAt.getTime()) {
        return apiError(
          'Another editor changed this article. Open a fresh copy before retrying.',
          409,
          'ARTICLE_CHANGED',
          requestId
        )
      }
    }
    const {
      title, slug, content, excerpt, coverImage, categoryId, status,
      corrected, correctionNote, seriesId, seriesOrder, tags, scheduledAt,
      authorId: bodyAuthorId,
      baseVersion, publicationIntent, editKind,
    } = body

    // The legacy correction flag and note are now derived from the corrections record. Setting them
    // here would publish (or hide) a notice with no date, no approval and no matching text change.
    if (corrected !== undefined || correctionNote !== undefined) {
      return apiError(
        'Corrections are issued from Manage corrections, not from the article editor.',
        400,
        'USE_CORRECTIONS_WORKFLOW',
        requestId
      )
    }

    // Optimistic concurrency: a client that says which version it was editing is refused
    // when the article has changed since (another tab, another person, a review action).
    // Clients that send no baseVersion (scripts, older pages) are not checked.
    if (typeof baseVersion === 'string' && baseVersion) {
      const currentVersion = articleVersion(existing, existing.tags.map((t) => t.tag.name))
      if (baseVersion !== currentVersion) {
        return apiError(
          'This article was changed in another tab or by someone else since you opened it.',
          409,
          'ARTICLE_CONFLICT',
          requestId
        )
      }
    }

    const nextCategoryId = categoryId !== undefined ? (categoryId || null) : existing.categoryId

    // Zero assignments means a global editor. Once assignments exist, enforce
    // both the article's current category and its requested destination so an
    // editor cannot move a document out of scope and lock themselves out.
    if (user.role === 'EDITOR') {
      const scope = await loadEditorCategoryScope(user.id)
      if (!editorCanAccessCategory(scope, existing.categoryId)) {
        return apiError(
          'This article is outside your assigned categories.',
          403,
          'CATEGORY_SCOPE_DENIED',
          requestId
        )
      }
      if (!editorCanAccessCategory(scope, nextCategoryId)) {
        return apiError(
          'You cannot move this article outside your assigned categories.',
          403,
          'CATEGORY_SCOPE_DENIED',
          requestId
        )
      }
    }

    let finalStatus = existing.status
    if (typeof status === 'string') {
      const allowedStatuses = isAdminOrEditor ? STAFF_ARTICLE_STATUSES : WRITER_UPDATE_STATUSES
      if ((allowedStatuses as readonly string[]).includes(status)) {
        finalStatus = status as ArticleStatus
      }
    }

    if (isAdminOrEditor && finalStatus !== existing.status &&
      ([existing.status,finalStatus].some(s=>s==='PUBLISHED'||s==='SCHEDULED')) && publicationIntent !== true) {
      return apiError('Confirm this publication change before saving.',409,'PUBLICATION_CONFIRMATION_REQUIRED',requestId)
    }

    // Validate scheduledAt is in the future when scheduling
    if (finalStatus === 'SCHEDULED' && scheduledAt) {
      const scheduledDate = parseEditorialScheduleInput(scheduledAt)
      if (!scheduledDate || scheduledDate <= new Date()) {
        return NextResponse.json({ error: 'Scheduled date must be in the future.' }, { status: 400 })
      }
    }

    // A SCHEDULED article must always carry a publish time: without one the
    // publish cron never picks it up and it sits in limbo forever. Saving an
    // already-scheduled article without resending the time keeps the existing
    // one (the autosave path), so only reject when neither is available.
    if (finalStatus === 'SCHEDULED' && !scheduledAt && !existing.scheduledAt) {
      return NextResponse.json(
        { error: 'A future publish date and time is required to schedule this article.' },
        { status: 400 }
      )
    }

    // Reader-facing text must be text: anything else would be compared and written as garbage.
    if ((title !== undefined && typeof title !== 'string') || (content !== undefined && typeof content !== 'string')
      || (excerpt !== undefined && excerpt !== null && typeof excerpt !== 'string')
      || (coverImage !== undefined && coverImage !== null && typeof coverImage !== 'string')
      || (slug !== undefined && typeof slug !== 'string')) {
      return apiError('Title, standfirst, article text, cover image and web address must be text.', 400, 'VALIDATION_ERROR', requestId)
    }

    // A live article's reader-facing text changes through one of two doors only:
    //   * Manage corrections (correction / clarification / update, with a public notice), or
    //   * here, as an explicitly declared minor copy edit (spelling, punctuation, formatting), which
    //     is recorded with before/after text in the audit log in the same transaction.
    // An unclassified change is refused, so autosave or a script cannot silently rewrite a live article.
    const liveBefore = existing.status === 'PUBLISHED'
    // The web address (src/lib/articleSlug.ts). An absent or empty slug means "leave it": autosave never
    // derives one from a half-typed headline. A typed one is normalised and validated. Once the article has
    // been published its address is permanent: links, shares, bookmarks and search results point at it, and
    // only the approved migration (scripts/migrate-article-slugs.ts, which records a 301) may change it.
    let nextSlug = existing.slug
    let slugReason: 'editor' | 'publication' | 'placeholder' | null = null
    // Only editors and administrators choose addresses (writers' clients still send one; it is ignored).
    // Resending the stored address (older clients send it on every save) is never a change.
    if (isAdminOrEditor && typeof slug === 'string' && slug.trim() && slug.trim() !== existing.slug) {
      const chosen = validateCustomSlug(slug)
      if (!chosen.ok || chosen.slug !== existing.slug) {
        if (isSlugLocked(existing)) {
          return apiError(
            'The web address of a published article cannot be changed: existing links would break.',
            409,
            'PUBLISHED_SLUG_LOCKED',
            requestId
          )
        }
        if (!chosen.ok) return apiError(chosen.error, 400, 'INVALID_SLUG', requestId)
        if (!(await isSlugAvailable(prisma, chosen.slug, id))) {
          return apiError('Another article already uses this web address. Choose a different one.', 409, 'SLUG_CONFLICT', requestId)
        }
        nextSlug = chosen.slug
        slugReason = 'editor'
      }
    }
    if (!slugReason && !existing.slug && !isSlugLocked(existing)) {
      // Repairs a draft that an earlier build saved with an empty address.
      nextSlug = await uniqueProvisionalSlug(prisma)
      slugReason = 'placeholder'
    }
    const finalisedSlug = await finalSlugForTransition(
      prisma,
      { id, slug: nextSlug, title: typeof title === 'string' ? title : existing.title, slugLockedAt: existing.slugLockedAt, status: existing.status },
      finalStatus
    )
    if (finalisedSlug && finalisedSlug !== nextSlug) {
      nextSlug = finalisedSlug
      slugReason = 'publication'
    }
    const now = new Date()
    // A byline on a live article is a matter of record: changing it is a correction, made in Manage corrections
    // together with a public note, never a silent save.
    if (liveBefore && isAdminOrEditor && typeof bodyAuthorId === 'string' && bodyAuthorId && bodyAuthorId !== existing.authorId) {
      return apiError(
        'The byline of a published article is changed through Manage corrections, with a public note.',
        409,
        'PUBLISHED_BYLINE_LOCKED',
        requestId
      )
    }

    const changedPublishedText = liveBefore && finalStatus === 'PUBLISHED'
      ? publishedTextChanges(existing, { title, excerpt, content, coverImage })
      : []
    if (changedPublishedText.length > 0 && editKind !== 'COPY_EDIT') {
      return apiError(
        'This article is live. Save the change as a minor copy edit, or use Manage corrections if it changes a fact or the meaning.',
        409,
        'PUBLISHED_TEXT_CHANGE_UNCLASSIFIED',
        requestId
      )
    }

    const wasJustSubmitted =
      existing.status !== 'PENDING_REVIEW' && finalStatus === 'PENDING_REVIEW'
    const wasPublished =
      existing.status !== 'PUBLISHED' && finalStatus === 'PUBLISHED'
    const wasUnpublished =
      existing.status === 'PUBLISHED' && finalStatus !== 'PUBLISHED'

    if (['PENDING_REVIEW', 'SCHEDULED', 'PUBLISHED'].includes(finalStatus)) {
      const altError = figureAltError(content ?? existing.content)
      if (altError) return NextResponse.json({ error: altError }, { status: 400 })
    }

    // Bounded and validated before the transaction opens, so the work inside it
    // is a known quantity.
    const normalizedTags = normalizeArticleTags(tags)

    // Database work only, so it is safe to run again if PostgreSQL aborts it for a lock conflict (issue #128): the
    // write is guarded on the row as read, so a retry after someone else's change is refused, never applied over it.
    // Image cleanup, notifications and cache refresh happen after the commit.
    const { article: updated, savedTagNames } = await withTransactionRetry('article:update', () => prisma.$transaction(async (tx) => {
      await lockArticleImages(tx, content ?? existing.content, coverImage ?? existing.coverImage)
      const savedArticle = await tx.article.update({
        // Recheck the authorised row at the write: a concurrent submission,
        // review, role-scoped category move or trash operation must not be undone.
        where: {
          id, deletedAt: null, updatedAt: existing.updatedAt,
          status: existing.status, authorId: existing.authorId, categoryId: existing.categoryId,
        },
        data: {
          ...(title !== undefined && { title }),
          ...(nextSlug !== existing.slug && { slug: nextSlug }),
          slugLockedAt: slugLockFor(existing, finalStatus, now),
          ...(content !== undefined && { content }),
          ...(excerpt !== undefined && { excerpt }),
          ...(coverImage !== undefined && { coverImage: coverImage || null }),
          ...(categoryId !== undefined && { categoryId: categoryId || null }),
          ...(isAdminOrEditor && bodyAuthorId && { authorId: bodyAuthorId }),
          ...(isAdminOrEditor && seriesId !== undefined && { seriesId: seriesId || null }),
          ...(isAdminOrEditor && seriesOrder !== undefined && { seriesOrder }),
          ...(wasJustSubmitted && { editorNote: null }),
          status: finalStatus,
          scheduledAt: finalStatus === 'SCHEDULED' && scheduledAt
            ? parseEditorialScheduleInput(scheduledAt)
            : finalStatus !== 'SCHEDULED'
            ? null
            : existing.scheduledAt,
          publishedAt: wasPublished
            ? now
            : wasUnpublished
            ? null
            : existing.publishedAt,
        },
      })

      if (savedArticle.slug !== existing.slug) {
        await tx.auditLog.create({
          data: {
            action: 'article.slug_changed', targetType: 'article', targetId: id, performedBy: user.id,
            metadata: {
              requestId, before: existing.slug, after: savedArticle.slug, status: existing.status, nextStatus: finalStatus,
              reason: slugReason, wasProvisional: isProvisionalSlug(existing.slug),
            },
          },
        })
      }
      if (changedPublishedText.length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'article.copy_edit',
            targetType: 'article',
            targetId: id,
            performedBy: user.id,
            metadata: {
              requestId,
              fields: changedPublishedText,
              before: Object.fromEntries(changedPublishedText.map((field) => [field, existing[field]])),
              after: Object.fromEntries(changedPublishedText.map((field) => [field, savedArticle[field]])),
            },
          },
        })
      }

      // Article fields and tag associations are one save operation. Keeping
      // them in the same transaction prevents a 500 after a partial update.
      // `tags` absent means "leave them alone"; an empty array means "clear them".
      let savedTagNames = existing.tags.map(t => t.tag.name)
      if (Array.isArray(tags)) {
        await tx.articleTag.deleteMany({ where: { articleId: id } })
        const tagRecords: Array<{ id: string; name: string }> = []
        for (const { name, slug: tagSlug } of [...normalizedTags].sort((a, b) => a.slug.localeCompare(b.slug))) {
          const tag = await resolveArticleTag(tx, { name, slug: tagSlug })
          tagRecords.push(tag)
        }
        savedTagNames = tagRecords.map(tag => tag.name)
        if (tagRecords.length > 0) {
          await tx.articleTag.createMany({
            data: tagRecords.map((tag) => ({ articleId: id, tagId: tag.id })),
            skipDuplicates: true,
          })
        }
      }

      return { article: savedArticle, savedTagNames }
    }, { timeout: ARTICLE_SAVE_TIMEOUT_MS }))

    await cleanupRemovedArticleImages(existing.content, existing.coverImage, updated.content, updated.coverImage)

    // Notify category editors when submitted
    if (wasJustSubmitted) {
      try {
        let editorIds: string[] = []

        if (nextCategoryId) {
          const assignments = await prisma.categoryEditor.findMany({
            where: { categoryId: nextCategoryId },
            select: { userId: true, user: { select: { email: true, name: true } } },
          })
          editorIds = assignments.map((assignment) => assignment.userId)

          for (const assignment of assignments) {
            if (assignment.user.email) {
              const { subject, html } = articleSubmittedEmail(
                existing.author.name ?? 'Unknown',
                updated.title,
                existing.id
              )
              await sendEmail({ to: assignment.user.email, subject, html })
            }
          }
        }

        // With no category-specific recipients, global editors and admins own
        // the queue. Notification failures must not turn a committed save into
        // a false "Save failed" response.
        if (editorIds.length === 0) {
          const allEditors = await prisma.user.findMany({
            where: { role: { in: ['ADMIN', 'EDITOR'] } },
            select: { id: true, email: true },
          })
          editorIds = allEditors.map((editor) => editor.id)
          for (const editor of allEditors) {
            if (editor.email) {
              const { subject, html } = articleSubmittedEmail(
                existing.author.name ?? 'Unknown',
                updated.title,
                existing.id
              )
              await sendEmail({ to: editor.email, subject, html })
            }
          }
        }

        await prisma.notification.createMany({
          data: editorIds.map((userId) => ({
            userId,
            type: 'article_submitted',
            title: 'New article for review',
            message: `"${updated.title}" by ${existing.author.name ?? 'Unknown'} is ready for review.`,
            articleId: existing.id,
          })),
        })
      } catch (notificationError) {
        console.error('[api/articles:update:notifications]', { requestId, notificationError })
      }
    }

    // A publish, unpublish, category move or any edit to a live article can
    // change the public lists — refresh their cache immediately.
    if (wasPublished || wasUnpublished || existing.status === 'PUBLISHED' || finalStatus === 'PUBLISHED') {
      try {
        await revalidateArticleLists()
      } catch (revalidationError) {
        console.error('[api/articles:update:revalidation]', { requestId, revalidationError })
      }
    }

    return NextResponse.json(
      { ...updated, version: articleVersion(updated, savedTagNames) },
      { headers: { 'x-request-id': requestId } }
    )
  } catch (error) {
    if (error instanceof ArticleImageUnavailableError) return NextResponse.json({ error: error.message }, { status: 400 })
    if (isHiddenDebateViolation(error)) return hiddenDebateResponse()
    return articleMutationErrorResponse(error, 'update', requestId)
  }
}

// PATCH is an alias for PUT - used by the autosave system

async function DELETEHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID()

  try {
    const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
    if (!auth.ok) return auth.response
    const user = auth.user
    const { id } = await params
    const isAdminOrEditor = user.role === 'ADMIN' || user.role === 'EDITOR'

    const existing = await prisma.article.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!isAdminOrEditor && existing.authorId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // A writer can delete only what they can still edit (a draft, or one returned to them). Trashing
    // a submitted, scheduled or published article would pull it from the queue or the public site
    // without an editor, which a writer cannot otherwise do (they cannot unpublish or edit it either).
    if (!isAdminOrEditor && existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      return apiError(
        'This article has been submitted or published, so only an editor can remove it.',
        403,
        'ARTICLE_LOCKED_FOR_WRITER',
        requestId
      )
    }

    if (user.role === 'EDITOR') {
      const scope = await loadEditorCategoryScope(user.id)
      if (!editorCanAccessCategory(scope, existing.categoryId)) {
        return apiError(
          'This article is outside your assigned categories.',
          403,
          'CATEGORY_SCOPE_DENIED',
          requestId
        )
      }
    }

    const revisionError = articleRevisionError(_req.headers.get('x-article-revision') ?? undefined, existing.updatedAt)
    if (revisionError) return revisionError

    // Soft delete - move to trash; permanently removed after 30 days by the cron job
    await prisma.article.update({ where: { id, updatedAt: existing.updatedAt, deletedAt: null, categoryId: existing.categoryId, authorId: existing.authorId }, data: { deletedAt: new Date() } })
    if (existing.status === 'PUBLISHED') await revalidateArticleLists()
    return NextResponse.json(
      { success: true },
      { headers: { 'x-request-id': requestId } }
    )
  } catch (error) {
    if (error instanceof ArticleImageUnavailableError) return NextResponse.json({ error: error.message }, { status: 400 })
    return articleMutationErrorResponse(error, 'delete', requestId)
  }
}

export const PUT = withTestingAudit(PUTHandler)

export const DELETE = withTestingAudit(DELETEHandler)

export const PATCH = PUT
