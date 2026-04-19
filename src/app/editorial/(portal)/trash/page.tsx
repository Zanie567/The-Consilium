import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { TrashList } from '@/components/editorial/TrashList'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trash | Editorial',
  robots: { index: false, follow: false },
}

export default async function TrashPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR') {
    redirect('/editorial')
  }

  const articles = await prisma.article.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      author: { select: { name: true } },
      category: { select: { name: true } },
    },
  }).catch(() => [])

  // Serialize dates for the client component
  const serialized = articles.map((a) => ({
    ...a,
    deletedAt: a.deletedAt?.toISOString() ?? '',
  }))

  return <TrashList initialArticles={serialized} />
}
