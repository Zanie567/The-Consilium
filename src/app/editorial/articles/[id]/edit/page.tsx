import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ArticleEditor } from '@/components/admin/ArticleEditor'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = { title: 'Edit Article | Editorial' }

export default async function EditorialEditArticlePage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const { id } = await params
  const isEditorOrAdmin = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'

  const article = await prisma.article.findUnique({
    where: {
      id,
      ...(isEditorOrAdmin ? {} : { authorId: session.user.id }),
    },
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
      }}
      categories={categories}
      authorId={session.user.id}
      canPublish={isEditorOrAdmin}
      returnUrl="/editorial/articles"
    />
  )
}
