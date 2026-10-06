import { requirePortalRole } from '@/lib/portalAccess'
import { prisma } from '@/lib/prisma'
import { ArticleEditor } from '@/components/admin/ArticleEditor'
import type { Metadata } from 'next'
import { loadEditorCategoryScope } from '@/lib/articleCategoryAccess'
import { categoryWhereForEditorScope } from '@/lib/articleCategoryScope'

export const metadata: Metadata = {
  title: 'New Article | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialNewArticlePage() {
  const session = await requirePortalRole(['ADMIN', 'EDITOR', 'WRITER'])

  const editorScope = session.user.role === 'EDITOR'
    ? await loadEditorCategoryScope(session.user.id)
    : null
  const categories = await prisma.category.findMany({
    where: editorScope ? categoryWhereForEditorScope(editorScope) : {},
    orderBy: { name: 'asc' },
  }).catch(() => [])
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
