import { requirePortalRole } from '@/lib/portalAccess'
import { prisma } from '@/lib/prisma'
import { ArticleEditor } from '@/components/admin/ArticleEditor'
import { formatEditorialScheduleInput } from '@/lib/editorialSchedule'
import { notFound } from 'next/navigation'
import { articleVersion } from '@/lib/articleVersion'
import type { Metadata } from 'next'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { categoryWhereForEditorScope, editorCanAccessCategory } from '@/lib/articleCategoryScope'

interface Props {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = {
  title: 'Edit Article | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialEditArticlePage({ params }: Props) {
  const session = await requirePortalRole(['ADMIN', 'EDITOR', 'WRITER'])

  const { id } = await params
  const isEditorOrAdmin = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'
  const isWriter = session.user.role === 'WRITER'

  const article = await prisma.article.findUnique({
    where: {
      id,
      ...(isEditorOrAdmin ? {} : { authorId: session.user.id }),
    },
    include: { tags: { include: { tag: true } } },
  }).catch(() => null)

  if (!article || article.deletedAt) notFound()

  const editorScope = session.user.role === 'EDITOR'
    ? await loadEditorCategoryScope(session.user.id)
    : null
  if (editorScope && !editorCanAccessCategory(editorScope, article.categoryId)) notFound()

  const categories = await prisma.category.findMany({
    where: editorScope ? categoryWhereForEditorScope(editorScope) : {},
    orderBy: { name: 'asc' },
  }).catch(() => [])

  return (
    <ArticleEditor
      articleId={article.id}
      initialData={{
        title: article.title,
        slug: article.slug,
        content: article.content,
        excerpt: article.excerpt ?? '',
        coverImage: article.coverImage ?? '',
        categoryId: article.categoryId ?? '',
        status: article.status,
        scheduledAt: formatEditorialScheduleInput(article.scheduledAt),
        editorNote: article.editorNote,
        tags: article.tags.map((t) => t.tag.name),
        version: articleVersion(article, article.tags.map((t) => t.tag.name)),
        // Pass the article's actual author so the dropdown defaults to the right person
        authorId: article.authorId,
      }}
      categories={categories}
      authorId={session.user.id}
      canPublish={isEditorOrAdmin}
      returnUrl="/editorial/articles"
      isWriter={isWriter}
    />
  )
}
