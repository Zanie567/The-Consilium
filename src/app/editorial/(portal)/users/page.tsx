import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserManagement } from '@/components/editorial/UserManagement'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Users | Editorial',
  robots: { index: false, follow: false },
}

export default async function UsersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  }).catch(() => null)
  if (!dbUser || (dbUser.role !== 'ADMIN' && dbUser.role !== 'EDITOR')) redirect('/editorial')

  const [users, categories] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
      select: {
        id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
        categoryAssignments: {
          select: { category: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
  ])

  const serializedUsers = JSON.parse(JSON.stringify(users))

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <div className="mb-8">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          User Management
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          Create and manage editorial team accounts.
        </p>
      </div>
      <UserManagement
        initialUsers={serializedUsers}
        categories={categories}
        currentUserId={session.user.id}
        currentUserRole={dbUser!.role}
      />
    </div>
  )
}
