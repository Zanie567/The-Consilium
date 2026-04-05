import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, articleReturnedEmail, articlePublishedEmail } from '@/lib/email'

interface Props {
  params: Promise<{ id: string }>
}

// PATCH — editor action on a submitted article
// action: 'approve' | 'reject' | 'schedule' | 'return' | 'unpublish'
export async function PATCH(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { action, note, scheduledAt, corrected, correctionNote } = await req.json()

  const article = await prisma.article.findUnique({
    where: { id },
    include: { author: true },
  })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Editors only see their assigned categories (unless ADMIN)
  if (session.user.role === 'EDITOR' && article.categoryId) {
    const assignment = await prisma.categoryEditor.findFirst({
      where: { userId: session.user.id, categoryId: article.categoryId },
    })
    if (!assignment) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let updates: Record<string, unknown> = {}
  let notifTitle = ''
  let notifMessage = ''

  switch (action) {
    case 'approve': {
      updates = { status: 'PUBLISHED', publishedAt: new Date(), isFeatured: false }
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
      updates = { status: 'SCHEDULED', scheduledAt: new Date(scheduledAt) }
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
      updates = { status: 'DRAFT', publishedAt: null, isFeatured: false }
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
