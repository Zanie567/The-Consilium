import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ReviewPanel } from '@/components/editorial/ReviewPanel'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Review Article | Editorial',
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function ReviewPage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    redirect('/editorial')
  }

  const { id } = await params
  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      author: true,
      category: true,
      notes: { include: { author: true }, orderBy: { createdAt: 'asc' } },
      series: true,
    },
  })

  if (!article || article.deletedAt) notFound()

  // Editors are scoped to assigned categories. Verify access before rendering
  // any article content to the client component.
  if (session.user.role === 'EDITOR') {
    if (article.categoryId) {
      const assignment = await prisma.categoryEditor.findFirst({
        where: { userId: session.user.id, categoryId: article.categoryId },
      })
      if (!assignment) notFound()
    } else {
      // Uncategorized article: block editors who have any category assignment (scoped editors).
      const anyAssignment = await prisma.categoryEditor.findFirst({
        where: { userId: session.user.id },
      })
      if (anyAssignment) notFound()
    }
  }

  // Serialize Prisma Date objects for client component
  const serialized = JSON.parse(JSON.stringify(article))

  return <ReviewPanel article={serialized} reviewerId={session.user.id} reviewerRole={session.user.role} />
}
