import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, articleReturnedEmail, articlePublishedEmail } from '@/lib/email'
import { parseEditorialScheduleInput } from '@/lib/editorialSchedule'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

interface Props {
  params: Promise<{ id: string }>
}

// PATCH - editor action on a submitted article
// action: 'approve' | 'reject' | 'schedule' | 'return' | 'unpublish'
export async function PATCH(req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { action, note, scheduledAt, corrected, correctionNote } = await req.json()

  const article = await prisma.article.findUnique({
    where: { id },
    include: { author: true },
  })
  if (!article || article.deletedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Editors only see their assigned categories (unless ADMIN).
  // The guard must apply even when the article has no category so that
  // category-restricted editors cannot review uncategorised articles.
  if (user.role === 'EDITOR') {
    if (article.categoryId) {
      const assignment = await prisma.categoryEditor.findFirst({
          where: { userId: user.id, categoryId: article.categoryId },
      })
      if (!assignment) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else {
      // Uncategorised article: an editor who has category restrictions cannot
      // review it because there is no matching assignment to grant access.
      const anyAssignment = await prisma.categoryEditor.findFirst({
        where: { userId: user.id },
      })
      if (anyAssignment) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  let updates: Record<string, unknown> = {}
  let notifTitle = ''
  let notifMessage = ''

  switch (action) {
    case 'approve': {
      updates = { status: 'PUBLISHED', publishedAt: new Date(), scheduledAt: null, isFeatured: false }
      notifTitle = 'Article published'
      notifMessage = `Your article "${article.title}" has been published.`
      // Email writer
      if (article.author.email) {
        const { subject, html } = articlePublishedEmail(article.title, article.slug)
        await sendEmail({ to: article.author.email, subject, html })
      }
      break
    }
    case 'schedule': {
      if (!scheduledAt) return NextResponse.json({ error: 'scheduledAt required' }, { status: 400 })
      // Reject dates that are not in the future to prevent accidental
      // immediate publication by the scheduler cron.
      const scheduledDate = parseEditorialScheduleInput(scheduledAt)
      if (!scheduledDate || scheduledDate <= new Date()) {
        return NextResponse.json({ error: 'scheduledAt must be a valid date in the future.' }, { status: 400 })
      }
      updates = { status: 'SCHEDULED', scheduledAt: scheduledDate }
      notifTitle = 'Article scheduled'
      notifMessage = `Your article "${article.title}" is scheduled for publication.`
      break
    }
    case 'return': {
      updates = { status: 'REJECTED', editorNote: note ?? null }
      notifTitle = 'Article returned'
      notifMessage = `Your article "${article.title}" has been returned with feedback.`
      if (article.author.email && note) {
        const { subject, html } = articleReturnedEmail(article.title, note, article.id)
        await sendEmail({ to: article.author.email, subject, html })
      }
      break
    }
    case 'unpublish': {
      updates = { status: 'DRAFT', publishedAt: null, scheduledAt: null, isFeatured: false }
      notifTitle = 'Article unpublished'
      notifMessage = `Your article "${article.title}" has been unpublished.`
      break
    }
    case 'correct': {
      updates = {
        corrected: corrected ?? false,
        correctionNote: correctionNote ?? null,
      }
      // No notification needed for correction notes
      const updated = await prisma.article.update({ where: { id }, data: updates })
      return NextResponse.json(updated)
    }
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const updated = await prisma.article.update({ where: { id }, data: updates })

  // Create in-app notification for the writer
  await prisma.notification.create({
    data: {
      userId: article.authorId,
      type: action,
      title: notifTitle,
      message: notifMessage,
      articleId: article.id,
    },
  })

  return NextResponse.json(updated)
}
