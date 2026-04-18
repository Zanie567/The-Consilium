import { articlePublishedEmail, sendEmail } from '@/lib/email'
import { prisma } from '@/lib/prisma'

interface ScheduledPublishArticleResult {
  id: string
  title: string
  slug: string
}

interface ScheduledPublishWarning {
  articleId: string
  title: string
  stage: 'email' | 'notification'
  message: string
}

export interface ScheduledPublishResult {
  ranAt: string
  dueCount: number
  published: ScheduledPublishArticleResult[]
  skipped: ScheduledPublishArticleResult[]
  warnings: ScheduledPublishWarning[]
}

export async function publishScheduledArticles(now = new Date()): Promise<ScheduledPublishResult> {
  const due = await prisma.article.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: now },
    },
    include: { author: true },
    orderBy: { scheduledAt: 'asc' },
  })

  const published: ScheduledPublishArticleResult[] = []
  const skipped: ScheduledPublishArticleResult[] = []
  const warnings: ScheduledPublishWarning[] = []

  for (const article of due) {
    // Use updateMany as a one-row compare-and-set so concurrent runs cannot
    // double-publish or send duplicate side effects for the same article.
    const updated = await prisma.article.updateMany({
      where: {
        id: article.id,
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        scheduledAt: null,
      },
    })

    const summary = { id: article.id, title: article.title, slug: article.slug }
    if (updated.count === 0) {
      skipped.push(summary)
      continue
    }

    if (article.author.email) {
      try {
        const { subject, html } = articlePublishedEmail(article.title, article.slug)
        await sendEmail({ to: article.author.email, subject, html })
      } catch (error) {
        warnings.push({
          articleId: article.id,
          title: article.title,
          stage: 'email',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    try {
      await prisma.notification.create({
        data: {
          userId: article.authorId,
          type: 'published',
          title: 'Article published',
          message: `Your article "${article.title}" has been published.`,
          articleId: article.id,
        },
      })
    } catch (error) {
      warnings.push({
        articleId: article.id,
        title: article.title,
        stage: 'notification',
        message: error instanceof Error ? error.message : String(error),
      })
    }

    published.push(summary)
  }

  return {
    ranAt: now.toISOString(),
    dueCount: due.length,
    published,
    skipped,
    warnings,
  }
}
