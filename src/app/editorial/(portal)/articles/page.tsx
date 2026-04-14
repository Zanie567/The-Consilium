import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ArticlesList } from '@/components/editorial/ArticlesList'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Articles | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialArticlesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')

  const role = session.user.role
  const isEditor = role === 'ADMIN' || role === 'EDITOR'
  const userId = session.user.id

  let assignedCategoryIds: string[] | null = null
  if (role === 'EDITOR') {
    const assignments = await prisma.categoryEditor.findMany({
      where: { userId },
      select: { categoryId: true },
    })
    assignedCategoryIds = assignments.map((a) => a.categoryId)
  }

  const articles = await prisma.article.findMany({
    where: {
      ...(role === 'WRITER' ? { authorId: userId } : {}),
      ...(assignedCategoryIds && assignedCategoryIds.length > 0
        ? { categoryId: { in: assignedCategoryIds } }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      isFeatured: true,
      isPinned: true,
      updatedAt: true,
      publishedAt: true,
      scheduledAt: true,
      slug: true,
      author: { select: { id: true, name: true } },
      category: { select: { name: true, slug: true } },
    },
  }).catch(() => [])

  return (
    <PortalPage className="p-6 lg:p-8 max-w-6xl">
      <PortalSection className="mb-6 flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {role === 'WRITER' ? 'My Articles' : 'All Articles'}
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            {articles.length} article{articles.length !== 1 ? 's' : ''}
          </p>
        </div>
        <a
          href="/editorial/articles/new"
          className="bg-navy text-gold px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
        >
          + New Article
        </a>
      </PortalSection>
      <PortalSection>
        <ArticlesList
          articles={articles as Parameters<typeof ArticlesList>[0]['articles']}
          isEditor={isEditor}
          isWriter={role === 'WRITER'}
        />
      </PortalSection>
    </PortalPage>
  )
}
