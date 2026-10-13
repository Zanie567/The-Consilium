import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { loadTeamDirectory, type TeamDirectory } from '@/lib/teamDirectory'
import { TeamMembersWorkspace } from '@/components/admin/TeamMembersWorkspace'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'

export const metadata: Metadata = {
  title: 'Team Members | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function TeamMembersPage() {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) redirect('/editorial')

  let directory: TeamDirectory | null = null
  try {
    directory = await loadTeamDirectory()
  } catch (error) {
    console.error('[team-members] directory unavailable', error)
  }

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <PortalSection className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)] mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
          Team Members
        </h1>
        <p className="text-[var(--fg-muted)] text-sm max-w-2xl">
          Everyone who works on The Consilium: their account, what they are allowed to do, and how they appear on the Our Team page.
          Access and the public profile are managed separately, so a new role never changes a title and a new title never grants access.
        </p>
      </PortalSection>
      <PortalSection>
        {directory ? (
          <TeamMembersWorkspace initial={directory} currentAdminEmail={admin.email} />
        ) : (
          <p role="alert" className="text-sm text-red-500">The team list could not be loaded. Reload to try again.</p>
        )}
      </PortalSection>
    </PortalPage>
  )
}
