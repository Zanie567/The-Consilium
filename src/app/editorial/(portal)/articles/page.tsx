import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArticlesList } from '@/components/editorial/ArticlesList'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Articles | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; status?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')

  const { mine: mineParam, status: statusParam } = await searchParams

  const role = session.user.role
  const isEditor = role === 'ADMIN' || role === 'EDITOR'
  const userId = session.user.id

  // "My Drafts" mode: filter to current user's drafts regardless of role
  const myDraftsMode = mineParam === 'true' && statusParam === 'DRAFT'

  let assignedCategoryIds: string[] | null = null
  if (role === 'EDITOR' && !myDraftsMode) {
    const assignments = await prisma.categoryEditor.findMany({
      where: { userId },
      select: { categoryId: true },
    })
    assignedCategoryIds = assignments.map((a) => a.categoryId)
  }

  // BUG-06: Surface DB errors rather than silently rendering an empty list
  let fetchError = false
  const articles = await prisma.article.findMany({
    where: {
      ...(myDraftsMode
        ? { authorId: userId, status: 'DRAFT' }
        : {
            ...(role === 'WRITER' ? { authorId: userId } : {}),
            ...(assignedCategoryIds && assignedCategoryIds.length > 0
              ? { categoryId: { in: assignedCategoryIds } }
              : {}),
          }),
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
  }).catch((err: unknown) => {
    console.error('[editorial/articles] DB error:', err)
    fetchError = true
    return []
  })

  const pageTitle = myDraftsMode
    ? 'My Drafts'
    : role === 'WRITER'
    ? 'My Articles'
    : 'All Articles'

  return (
    <PortalPage className="p-6 lg:p-8 max-w-6xl">
      {/* BUG-06: Surface DB errors rather than silently rendering an empty list */}
      {fetchError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/20 px-5 py-4 text-red-600 dark:text-red-400 text-sm">
          Articles could not be loaded. This is usually a temporary database issue.
          Please refresh the page.
        </div>
      )}
      <PortalSection className="mb-6 flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {pageTitle}
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
          key={myDraftsMode ? 'my-drafts' : 'all-articles'}
          articles={articles as Parameters<typeof ArticlesList>[0]['articles']}
          isEditor={isEditor && !myDraftsMode}
          isWriter={role === 'WRITER'}
          emptyMessage={
            myDraftsMode ? (
              <span>
                You have no drafts yet.{' '}
                <Link href="/editorial/articles/new" className="text-gold hover:underline">
                  Start writing →
                </Link>
              </span>
            ) : undefined
          }
        />
      </PortalSection>
    </PortalPage>
  )
}
