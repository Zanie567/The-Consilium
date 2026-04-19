import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ArticleEditor } from '@/components/admin/ArticleEditor'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'New Article | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialNewArticlePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role === 'GROWTH') redirect('/editorial')

  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } }).catch(() => [])
  const isEditorOrAdmin = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'

  return (
    <ArticleEditor
      categories={categories}
      authorId={session.user.id}
      canPublish={isEditorOrAdmin}
      returnUrl="/editorial/articles"
      isWriter={session.user.role === 'WRITER'}
    />
  )
}
