import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ArticleEditor } from '@/components/admin/ArticleEditor'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = {
  title: 'Edit Article | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialEditArticlePage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')

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

  if (!article) notFound()

  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } }).catch(() => [])

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
        scheduledAt: article.scheduledAt ? article.scheduledAt.toISOString().slice(0, 16) : null,
        editorNote: article.editorNote,
        tags: article.tags.map((t) => t.tag.name),
      }}
      categories={categories}
      authorId={session.user.id}
      canPublish={isEditorOrAdmin}
      returnUrl="/editorial/articles"
      isWriter={isWriter}
    />
  )
}
