import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { requirePortalRole } from '@/lib/portalAccess'
import { prisma } from '@/lib/prisma'
import { CORRECTION_PREPARE_ROLES } from '@/lib/rbac'
import { CorrectionError, canApproveCorrections, loadArticleForCorrections, loadAuthorOptions, loadCorrectionHistory } from '@/lib/corrections/service'
import { CorrectionsManager, type ManagerData } from '@/components/editorial/corrections/CorrectionsManager'

export const metadata: Metadata = {
  title: 'Manage Corrections | Editorial',
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function ManageCorrectionsPage({ params }: Props) {
  const session = await requirePortalRole(CORRECTION_PREPARE_ROLES)
  const { id } = await params
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, name: true } })
  if (!user) notFound()

  let loaded: Awaited<ReturnType<typeof loadArticleForCorrections>>
  try {
    loaded = await loadArticleForCorrections(prisma, user, id)
  } catch (error) {
    // Missing, trashed, or outside an editor's categories: never render any of its data.
    if (error instanceof CorrectionError) notFound()
    throw error
  }
  const [history, authors] = await Promise.all([loadCorrectionHistory(prisma, id), loadAuthorOptions(prisma)])
  const { article, version } = loaded

  const data: ManagerData = JSON.parse(JSON.stringify({
    article: {
      id: article.id, title: article.title, slug: article.slug, excerpt: article.excerpt, content: article.content,
      coverImage: article.coverImage, authorId: article.authorId, authorName: article.author.name,
      status: article.status, publishedAt: article.publishedAt, updatedAt: article.updatedAt,
    },
    version,
    viewer: { id: user.id, canApprove: canApproveCorrections(user.role) },
    authors,
    ...history,
  }))

  return <CorrectionsManager initialData={data} />
}
