import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { listMembers, type MemberRow } from '@/lib/membership'
import { MemberManagement } from '@/components/admin/MemberManagement'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'

export const metadata: Metadata = {
  title: 'Members | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function MembersPage() {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) redirect('/editorial')

  let members: MemberRow[] = []
  let loadFailed = false
  try {
    members = await listMembers()
  } catch {
    loadFailed = true
  }

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <PortalSection className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)] mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
          Members
        </h1>
        <p className="text-[var(--fg-muted)] text-sm max-w-2xl">
          Give a new hire access before they have an account. When they sign in with that email, the role switches
          on by itself. Access and the public Our Team card are managed separately.
        </p>
      </PortalSection>
      <PortalSection>
        {loadFailed ? (
          <p role="alert" className="text-sm text-red-500">The member list could not be loaded. Reload to try again.</p>
        ) : (
          <MemberManagement initialMembers={members} currentAdminEmail={admin.email} />
        )}
      </PortalSection>
    </PortalPage>
  )
}
