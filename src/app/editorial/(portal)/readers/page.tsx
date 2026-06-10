import { getVerifiedSessionUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { READ_THROUGH_ACCESS_ROLES } from '@/lib/rbac'
import { ReadersDashboard } from './ReadersDashboard'

export const metadata: Metadata = {
  title: 'Your Readers | Editorial',
  robots: { index: false, follow: false },
}

export default async function ReadersPage() {
  const user = await getVerifiedSessionUser(READ_THROUGH_ACCESS_ROLES)
  if (!user) {
    redirect('/editorial')
  }

  // Admins can look at any author's read-through; everyone else only their own.
  const authors =
    user.role === 'ADMIN'
      ? await prisma.user
          .findMany({
            where: { articles: { some: { status: 'PUBLISHED', deletedAt: null } } },
            select: { id: true, name: true, email: true },
            orderBy: { name: 'asc' },
          })
          .catch(() => [])
      : []

  return (
    <ReadersDashboard
      currentUserId={user.id}
      isAdmin={user.role === 'ADMIN'}
      authors={authors.map((a) => ({ id: a.id, name: a.name ?? a.email ?? 'Unknown' }))}
    />
  )
}
