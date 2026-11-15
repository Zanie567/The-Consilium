import { requirePortalRole } from '@/lib/portalAccess'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { ArticlesList } from '@/components/editorial/ArticlesList'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { articleWhereForEditorScope, type EditorCategoryScope } from '@/lib/articleCategoryScope'
import type { Metadata } from 'next'

/**
 * Most articles the list loads. Search, sorting and filtering run in the browser over this set,
 * so it has to be large enough to hold everything an editor is likely to look for, and bounded
 * so the page stays a single quick query. When there are more, the list says so.
 */
const ARTICLE_LIST_LIMIT = 300

export const metadata: Metadata = {
  title: 'Articles | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; status?: string }>
}) {
  const session = await requirePortalRole(['ADMIN', 'EDITOR', 'WRITER'])

  const { mine: mineParam, status: statusParam } = await searchParams

  const role = session.user.role
  const isEditor = role === 'ADMIN' || role === 'EDITOR'
  const userId = session.user.id

  // "My Drafts" mode: filter to current user's drafts regardless of role
  const myDraftsMode = mineParam === 'true' && statusParam === 'DRAFT'

  let editorScope: EditorCategoryScope | null = null
  if (role === 'EDITOR' && !myDraftsMode) {
    editorScope = await loadEditorCategoryScope(userId)
  }

  // Surface DB errors rather than silently rendering an empty list
  let fetchError = false
  const loaded = await prisma.article.findMany({
    where: {
      deletedAt: null,
      ...(myDraftsMode
        ? { authorId: userId, status: 'DRAFT' }
        : {
            ...(role === 'WRITER' ? { authorId: userId } : {}),
            ...(editorScope ? articleWhereForEditorScope(editorScope) : {}),
          }),
    },
    orderBy: { updatedAt: 'desc' },
    // One more than the list shows, which is how the page knows older articles were left out
    // without running a second (count) query.
    take: ARTICLE_LIST_LIMIT + 1,
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
      // The cover's address only: the list draws it as a small thumbnail.
      coverImage: true,
      author: { select: { id: true, name: true } },
      category: { select: { name: true, slug: true } },
      tags: { select: { tag: { select: { name: true, slug: true } } }, orderBy: { tag: { name: 'asc' } } },
    },
  }).catch((err: unknown) => {
    console.error('[editorial/articles] DB error:', err)
    // eslint-disable-next-line react-hooks/immutability -- server component, no render cycle
    fetchError = true
    return []
  })
  const truncated = loaded.length > ARTICLE_LIST_LIMIT
  const articles = truncated ? loaded.slice(0, ARTICLE_LIST_LIMIT) : loaded

  const pageTitle = myDraftsMode
    ? 'My Drafts'
    : role === 'WRITER'
    ? 'My Articles'
    : 'All Articles'

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      {/* Surface DB errors rather than silently rendering an empty list */}
      {fetchError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/20 px-5 py-4 text-red-600 dark:text-red-400 text-sm">
          Articles could not be loaded. This is usually a temporary database issue.
          Please refresh the page.
        </div>
      )}
      <PortalSection className="mb-6 flex items-center justify-between pl-10 md:pl-0">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {pageTitle}
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            {truncated ? `${articles.length} most recently updated articles` : `${articles.length} article${articles.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <a
          href="/editorial/articles/new"
          className="bg-navy text-gold px-3 sm:px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors min-h-[44px] flex items-center"
        >
          + New
        </a>
      </PortalSection>
      <PortalSection>
        <ArticlesList
          key={myDraftsMode ? 'my-drafts' : 'all-articles'}
          articles={articles.map(article => ({ ...article, updatedAt: article.updatedAt.toISOString(), publishedAt: article.publishedAt?.toISOString() ?? null, scheduledAt: article.scheduledAt?.toISOString() ?? null }))}
          isEditor={isEditor && !myDraftsMode}
          isWriter={role === 'WRITER'}
          truncated={truncated}
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
