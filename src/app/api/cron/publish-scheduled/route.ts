import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, articlePublishedEmail } from '@/lib/email'

export async function GET(req: Request) {
  // Verify this is called by Vercel Cron (or a trusted source)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const due = await prisma.article.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now }, deletedAt: null },
    include: { author: true },
  })

  const results: string[] = []
  for (const article of due) {
    await prisma.article.update({
      where: { id: article.id },
      data: { status: 'PUBLISHED', publishedAt: now },
    })

    if (article.author.email) {
      const { subject, html } = articlePublishedEmail(article.title, article.slug)
      await sendEmail({ to: article.author.email, subject, html })
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

    results.push(article.id)
  }

  // Permanently purge articles that have been in the trash for more than 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const purged = await prisma.article.deleteMany({
    where: { deletedAt: { not: null, lte: thirtyDaysAgo } },
  })

  return NextResponse.json({ published: results.length, ids: results, purged: purged.count })
}
