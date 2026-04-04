import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ArticleEditor } from '@/components/admin/ArticleEditor'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New Article | Editorial' }

export default async function EditorialNewArticlePage() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } }).catch(() => [])

  return (
    <ArticleEditor
      categories={categories}
      authorId={session.user.id}
      canPublish={session.user.role === 'ADMIN' || session.user.role === 'EDITOR'}
      returnUrl="/editorial/articles"
    />
  )
}
