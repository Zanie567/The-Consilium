import { articleRevisionError } from '@/lib/articleRevision'
import { isHiddenDebateViolation, hiddenDebateResponse } from '@/lib/hiddenDebateGuard'
import { figureAltError } from '@/lib/figureValidation'
import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, articleReturnedEmail, articlePublishedEmail } from '@/lib/email'
import { parseEditorialScheduleInput } from '@/lib/editorialSchedule'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { editorCanAccessCategory } from '@/lib/articleCategoryScope'
import { apiError, apiServerErrorResponse } from '@/lib/apiResponse'
import { Prisma, type ArticleStatus } from '@prisma/client'

interface Props {
  params: Promise<{ id: string }>
}

type ReviewAction = 'approve' | 'schedule' | 'return' | 'unpublish' | 'correct'

// The source status each review action is legal from, enforced server-side
// so a stale client or a replayed request can never push an article through
// a transition that doesn't make sense (e.g. "approve" a DRAFT that was
// never submitted, or "unpublish" something that isn't published).
const REQUIRED_SOURCE_STATUS: Record<ReviewAction, ArticleStatus> = {
  approve: 'PENDING_REVIEW',
  schedule: 'PENDING_REVIEW',
  return: 'PENDING_REVIEW',
  unpublish: 'PUBLISHED',
  correct: 'PUBLISHED',
}

function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && value in REQUIRED_SOURCE_STATUS
}

// PATCH - editor action on a submitted article
// action: 'approve' | 'schedule' | 'return' | 'unpublish' | 'correct'
async function PATCHHandler(req: Request, { params }: Props) {
  const requestId = crypto.randomUUID()

  try {
    const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
    if (!auth.ok) return auth.response
    const user = auth.user

    const { id } = await params
    const { action, note, scheduledAt, corrected, correctionNote, expectedUpdatedAt } = await req.json()

    if (!isReviewAction(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const article = await prisma.article.findUnique({
      where: { id },
      include: { author: true },
    })
    if (!article || article.deletedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Editors only see their assigned categories (unless ADMIN).
    // The guard must apply even when the article has no category so that
    // category-restricted editors cannot review uncategorised articles.
    if (user.role === 'EDITOR') {
      const scope = await loadEditorCategoryScope(user.id)
      if (!editorCanAccessCategory(scope, article.categoryId)) {
        return apiError(
          'This article is outside your assigned categories.',
          403,
          'CATEGORY_SCOPE_DENIED',
          requestId
        )
      }
    }

    const revisionError = articleRevisionError(expectedUpdatedAt, article.updatedAt)
    if (revisionError) return revisionError

    const requiredStatus = REQUIRED_SOURCE_STATUS[action]
    if (article.status !== requiredStatus) {
      return apiError(
        `This article must be ${requiredStatus} to ${action}; it is currently ${article.status}.`,
        409,
        'INVALID_STATUS_TRANSITION',
        requestId
      )
    }

    if (action === 'approve' || action === 'schedule') {
      const altError = figureAltError(article.content)
      if (altError) return NextResponse.json({ error: altError }, { status: 400 })
    }

    let updates: Record<string, unknown> = {}
    let notifTitle = ''
    let notifMessage = ''
    // Email is dispatched only after the mutation below has committed, and
    // its failure must never turn a successful review action into an error
    // response — so it's captured here and sent as a best-effort side
    // effect, not inline with the transaction.
    let sendPostCommitEmail: (() => Promise<void>) | null = null

    switch (action) {
      case 'approve': {
        updates = { status: 'PUBLISHED', publishedAt: new Date(), scheduledAt: null, isFeatured: false }
        notifTitle = 'Article published'
        notifMessage = `Your article "${article.title}" has been published.`
        const authorEmail = article.author.email
        if (authorEmail) {
          sendPostCommitEmail = async () => {
            const { subject, html } = articlePublishedEmail(article.title, article.slug)
            await sendEmail({ to: authorEmail, subject, html })
          }
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
        const authorEmail = article.author.email
        if (authorEmail && note) {
          sendPostCommitEmail = async () => {
            const { subject, html } = articleReturnedEmail(article.title, note, article.id)
            await sendEmail({ to: authorEmail, subject, html })
          }
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
        const updated = await prisma.article.update({
          where: { id, status: requiredStatus, deletedAt: null, updatedAt: article.updatedAt },
          data: { corrected: corrected ?? false, correctionNote: correctionNote ?? null },
        })
        revalidateArticleLists() // correction edits a live article
        return NextResponse.json(updated)
      }
    }

    // The status mutation and the writer's in-app notification commit
    // together: a notification-insert failure rolls the whole transaction
    // back rather than leaving a published/scheduled/returned article with
    // a false "failed" response, or a notification with no matching state
    // change.
    const updated = await prisma.$transaction(async (tx) => {
      // The source state and revision must still match at the actual write.
      // PostgreSQL rechecks this predicate after a concurrent writer commits.
      const savedArticle = await tx.article.update({
        where: { id, status: requiredStatus, deletedAt: null, updatedAt: article.updatedAt },
        data: updates,
      })
      await tx.notification.create({
        data: {
          userId: article.authorId,
          type: action,
          title: notifTitle,
          message: notifMessage,
          articleId: article.id,
        },
      })
      return savedArticle
    })

    // Approving publishes the article (and the other review actions move it
    // between draft/scheduled states) — refresh the public list cache.
    revalidateArticleLists()

    if (sendPostCommitEmail) {
      try {
        await sendPostCommitEmail()
      } catch (emailError) {
        console.error('[api/editorial/review:email]', { requestId, action, emailError })
      }
    }

    return NextResponse.json(updated, { headers: { 'x-request-id': requestId } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return apiError(
        'This article changed while you were reviewing it. Reload before retrying.',
        409,
        'INVALID_STATUS_TRANSITION',
        requestId
      )
    }
    if (isHiddenDebateViolation(error)) return hiddenDebateResponse()
    return apiServerErrorResponse(error, {
      operation: 'api/editorial/review',
      userMessage: 'This review action could not be completed because of a server error.',
      code: 'REVIEW_ACTION_FAILED',
      requestId,
    })
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
