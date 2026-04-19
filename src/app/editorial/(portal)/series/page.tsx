import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SeriesManager } from '@/components/editorial/SeriesManager'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Article Series | Editorial',
  robots: { index: false, follow: false },
}

export default async function SeriesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') redirect('/editorial')

  const [allSeries, publishedArticles] = await Promise.all([
    prisma.series.findMany({
      include: {
        articles: {
          select: { id: true, title: true, slug: true, seriesOrder: true },
          orderBy: { seriesOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      select: { id: true, title: true, seriesId: true, seriesOrder: true },
      orderBy: { publishedAt: 'desc' },
    }),
  ])

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      <PortalSection className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Article Series
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          Group related articles into a series with navigation between parts.
        </p>
      </PortalSection>
      <PortalSection>
        <SeriesManager
          initialSeries={allSeries as Parameters<typeof SeriesManager>[0]['initialSeries']}
          articles={publishedArticles}
        />
      </PortalSection>
    </PortalPage>
  )
}
