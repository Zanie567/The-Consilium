import { redirect } from 'next/navigation'
import { getVerifiedSessionUser } from '@/lib/auth'
import { AdminUsersPage } from '@/components/admin/AdminUsersPage'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'
import { ADMIN_ONLY } from '@/lib/rbac'

export const metadata: Metadata = {
  title: 'User Management | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const user = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!user) redirect('/editorial')

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
        <AdminUsersPage currentAdminId={user.id} />
      </PortalSection>
    </PortalPage>
  )
}
