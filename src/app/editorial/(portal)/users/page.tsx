import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AdminUsersPage } from '@/components/admin/AdminUsersPage'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'User Management | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  }).catch(() => null)

  // Admin only — editors can no longer access user management
  if (!dbUser || dbUser.role !== 'ADMIN') redirect('/editorial')

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8">
      <PortalSection className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1
          className="text-2xl font-bold text-[var(--fg)] mb-1"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          User Management
        </h1>
        <p className="text-[var(--fg-muted)] text-sm">
          Full visibility and control over all registered accounts.
        </p>
      </PortalSection>
      <PortalSection>
        <AdminUsersPage currentAdminId={session.user.id} />
      </PortalSection>
    </PortalPage>
  )
}
