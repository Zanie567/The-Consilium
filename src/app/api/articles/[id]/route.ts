import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, articleSubmittedEmail } from '@/lib/email'
import { parseEditorialScheduleInput } from '@/lib/editorialSchedule'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const session = await getServerSession(authOptions)

    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        author: true,
        category: true,
        series: true,
        tags: { include: { tag: true } },
      },
    })
    if (!article || article.deletedAt) return Response.json({ error: 'Not found' }, { status: 404 })

    const isOwner = session?.user?.id === article.authorId
    const isAdmin = session?.user?.role === 'ADMIN'
    const isEditor = session?.user?.role === 'EDITOR'
    const isEditorial = isAdmin || isEditor

    if (article.status === 'PUBLISHED' && !isOwner && !isEditorial) {
      return Response.json(article)
    }

    const authError = requireActiveSession(session)
    if (authError) return authError

    if (!isOwner && !isEditorial) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (isEditor) {
      if (article.categoryId) {
        const assignment = await prisma.categoryEditor.findFirst({
          where: { userId: session!.user.id, categoryId: article.categoryId },
        })
        if (!assignment) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else {
        const anyAssignment = await prisma.categoryEditor.findFirst({
          where: { userId: session!.user.id },
        })
        if (anyAssignment) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    }

    if (!isEditorial) {
      return Response.json(article)
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

    return Response.json(articleWithNotes)
  } catch {
    return Response.json({ error: 'Failed to fetch article' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError

  const { id } = await params
  const isAdminOrEditor = session!.user.role === 'ADMIN' || session!.user.role === 'EDITOR'

  try {
    const existing = await prisma.article.findUnique({
      where: { id },
      include: { author: true, category: true },
    })
    if (!existing || existing.deletedAt) return Response.json({ error: 'Not found' }, { status: 404 })

    // Writers can only edit their own articles
    if (!isAdminOrEditor && existing.authorId !== session!.user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Writers cannot edit articles that are pending/published (unless editor returned them)
    if (
      !isAdminOrEditor &&
      existing.status !== 'DRAFT' &&
      existing.status !== 'REJECTED'
    ) {
      return Response.json(
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

    // Writers can only set status to DRAFT or PENDING_REVIEW
    let finalStatus = existing.status
    if (isAdminOrEditor && status) {
      finalStatus = status
    } else if (!isAdminOrEditor && (status === 'DRAFT' || status === 'PENDING_REVIEW')) {
      finalStatus = status
    }

    // Validate scheduledAt is in the future when scheduling
    if (finalStatus === 'SCHEDULED' && scheduledAt) {
      const scheduledDate = parseEditorialScheduleInput(scheduledAt)
      if (!scheduledDate || scheduledDate <= new Date()) {
        return Response.json({ error: 'Scheduled date must be in the future.' }, { status: 400 })
      }
    }

    const wasJustSubmitted =
      existing.status !== 'PENDING_REVIEW' && finalStatus === 'PENDING_REVIEW'
    const wasPublished =
      existing.status !== 'PUBLISHED' && finalStatus === 'PUBLISHED'
    const wasUnpublished =
      existing.status === 'PUBLISHED' && finalStatus !== 'PUBLISHED'

    const updated = await prisma.article.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug }),
        ...(content !== undefined && { content }),
        ...(excerpt !== undefined && { excerpt }),
        ...(coverImage !== undefined && { coverImage: coverImage || null }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
        // Admins and editors may reassign the article to a different author
        ...(isAdminOrEditor && bodyAuthorId && { authorId: bodyAuthorId }),
        ...(corrected !== undefined && { corrected }),
        ...(correctionNote !== undefined && { correctionNote }),
        ...(seriesId !== undefined && { seriesId: seriesId || null }),
        ...(seriesOrder !== undefined && { seriesOrder }),
        // Clear editor note when writer resubmits
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

    // Notify category editors when submitted
    if (wasJustSubmitted) {
      let editorIds: string[] = []

      if (nextCategoryId) {
        const assignments = await prisma.categoryEditor.findMany({
          where: { categoryId: nextCategoryId },
          select: { userId: true, user: { select: { email: true, name: true } } },
        })
        editorIds = assignments.map((a) => a.userId)

        // Email each assigned editor
        for (const a of assignments) {
          if (a.user.email) {
            const { subject, html } = articleSubmittedEmail(
              existing.author.name ?? 'Unknown',
              updated.title,
              existing.id
            )
            await sendEmail({ to: a.user.email, subject, html })
          }
        }
      }

      // If no assigned editors, notify all EDITOR + ADMIN users
      if (editorIds.length === 0) {
        const allEditors = await prisma.user.findMany({
          where: { role: { in: ['ADMIN', 'EDITOR'] } },
          select: { id: true, email: true },
        })
        editorIds = allEditors.map((e) => e.id)
        for (const e of allEditors) {
          if (e.email) {
            const { subject, html } = articleSubmittedEmail(
              existing.author.name ?? 'Unknown',
              updated.title,
              existing.id
            )
            await sendEmail({ to: e.email, subject, html })
          }
        }
      }

      // In-app notifications
      await prisma.notification.createMany({
        data: editorIds.map((uid) => ({
          userId: uid,
          type: 'article_submitted',
          title: 'New article for review',
          message: `"${updated.title}" by ${existing.author.name ?? 'Unknown'} is ready for review.`,
          articleId: existing.id,
        })),
      })
    }

    // Sync tags
    if (Array.isArray(tags)) {
      // Upsert each tag, then replace article's tag associations
      await prisma.articleTag.deleteMany({ where: { articleId: id } })
      if (tags.length > 0) {
        const tagRecords = await Promise.all(
          tags.map((name: string) => {
            const tagSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
            return prisma.tag.upsert({
              where: { slug: tagSlug },
              update: {},
              create: { name, slug: tagSlug },
            })
          })
        )
        await prisma.articleTag.createMany({
          data: tagRecords.map((t) => ({ articleId: id, tagId: t.id })),
          skipDuplicates: true,
        })
      }
    }

    return Response.json(updated)
  } catch (error) {
    console.error('Update article error:', error)
    return Response.json({ error: 'Failed to update article' }, { status: 500 })
  }
}

// PATCH is an alias for PUT - used by the autosave system
export const PATCH = PUT

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  const authError2 = requireActiveSession(session)
  if (authError2) return authError2

  const { id } = await params
  const isAdminOrEditor = session!.user.role === 'ADMIN' || session!.user.role === 'EDITOR'

  try {
    const existing = await prisma.article.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!isAdminOrEditor && existing.authorId !== session!.user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Soft delete - move to trash; permanently removed after 30 days by the cron job
    await prisma.article.update({ where: { id }, data: { deletedAt: new Date() } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete article' }, { status: 500 })
  }
}
