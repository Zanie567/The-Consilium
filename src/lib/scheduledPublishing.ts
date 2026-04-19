import { prisma } from '@/lib/prisma'
import { sendEmail, articlePublishedEmail } from '@/lib/email'

export async function publishScheduledArticles(now = new Date()) {
  const due = await prisma.article.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: now },
    },
    include: { author: true },
    orderBy: { scheduledAt: 'asc' },
  })

  const published: string[] = []

  for (const article of due) {
    // Compare-and-set so concurrent triggers do not double-publish and
    // double-notify the same article.
    const result = await prisma.article.updateMany({
      where: {
        id: article.id,
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
      },
    })

    if (result.count === 0) continue

    if (article.author.email) {
      try {
        const { subject, html } = articlePublishedEmail(article.title, article.slug)
        await sendEmail({ to: article.author.email, subject, html })
      } catch (emailErr) {
        console.error(`[publish-scheduled] Email failed for article ${article.id}:`, emailErr)
      }
    }

    await prisma.notification.create({
      data: {
        userId: article.authorId,
        type: 'published',
        title: 'Article published',
        message: `Your article "${article.title}" has been published.`,
        articleId: article.id,
      },
    })

    published.push(article.id)
  }

  return published
}
