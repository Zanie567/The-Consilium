import { NextResponse, NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession, requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, articleSubmittedEmail } from '@/lib/email'
import { parseEditorialScheduleInput } from '@/lib/editorialSchedule'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { PUBLIC_AUTHOR_SELECT } from '@/lib/publicUser'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { editorCanAccessCategory } from '@/lib/articleCategoryScope'
import { apiError, articleMutationErrorResponse } from '@/lib/apiResponse'
import { ARTICLE_SAVE_TIMEOUT_MS, normalizeArticleTags } from '@/lib/articleTags'
import type { ArticleStatus } from '@prisma/client'

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
      return NextResponse.json(article)
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
      return NextResponse.json(article)
    }

    const articleWithNotes = await prisma.article.findUnique({
      where: { id },
      include: {
        author: true,
        category: true,
        notes: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        series: true,
        tags: { include: { tag: true } },
      },
    })

    return NextResponse.json(articleWithNotes)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch article' }, { status: 500 })
  }
}

export async function PUT(
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
      include: { author: true, category: true },
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
    const {
      title, slug, content, excerpt, coverImage, categoryId, status,
      corrected, correctionNote, seriesId, seriesOrder, tags, scheduledAt,
      authorId: bodyAuthorId,
    } = body

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

    const wasJustSubmitted =
      existing.status !== 'PENDING_REVIEW' && finalStatus === 'PENDING_REVIEW'
    const wasPublished =
      existing.status !== 'PUBLISHED' && finalStatus === 'PUBLISHED'
    const wasUnpublished =
      existing.status === 'PUBLISHED' && finalStatus !== 'PUBLISHED'

    // Bounded and validated before the transaction opens, so the work inside it
    // is a known quantity.
    const normalizedTags = normalizeArticleTags(tags)

    const updated = await prisma.$transaction(async (tx) => {
      const savedArticle = await tx.article.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(slug !== undefined && { slug }),
          ...(content !== undefined && { content }),
          ...(excerpt !== undefined && { excerpt }),
          ...(coverImage !== undefined && { coverImage: coverImage || null }),
          ...(categoryId !== undefined && { categoryId: categoryId || null }),
          ...(isAdminOrEditor && bodyAuthorId && { authorId: bodyAuthorId }),
          ...(isAdminOrEditor && corrected !== undefined && { corrected }),
          ...(isAdminOrEditor && correctionNote !== undefined && { correctionNote }),
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
            ? new Date()
            : wasUnpublished
            ? null
            : existing.publishedAt,
        },
      })

      // Article fields and tag associations are one save operation. Keeping
      // them in the same transaction prevents a 500 after a partial update.
      // `tags` absent means "leave them alone"; an empty array means "clear them".
      if (Array.isArray(tags)) {
        await tx.articleTag.deleteMany({ where: { articleId: id } })
        const tagRecords: Array<{ id: string }> = []
        for (const { name, slug: tagSlug } of normalizedTags) {
          const tag = await tx.tag.upsert({
            where: { slug: tagSlug },
            update: {},
            create: { name, slug: tagSlug },
          })
          tagRecords.push(tag)
        }
        if (tagRecords.length > 0) {
          await tx.articleTag.createMany({
            data: tagRecords.map((tag) => ({ articleId: id, tagId: tag.id })),
            skipDuplicates: true,
          })
        }
      }

      return savedArticle
    }, { timeout: ARTICLE_SAVE_TIMEOUT_MS })

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
        revalidateArticleLists()
      } catch (revalidationError) {
        console.error('[api/articles:update:revalidation]', { requestId, revalidationError })
      }
    }

    return NextResponse.json(updated, { headers: { 'x-request-id': requestId } })
  } catch (error) {
    return articleMutationErrorResponse(error, 'update', requestId)
  }
}

// PATCH is an alias for PUT - used by the autosave system
export const PATCH = PUT

export async function DELETE(
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

    // Soft delete - move to trash; permanently removed after 30 days by the cron job
    await prisma.article.update({ where: { id }, data: { deletedAt: new Date() } })
    if (existing.status === 'PUBLISHED') revalidateArticleLists()
    return NextResponse.json(
      { success: true },
      { headers: { 'x-request-id': requestId } }
    )
  } catch (error) {
    return articleMutationErrorResponse(error, 'delete', requestId)
  }
}
