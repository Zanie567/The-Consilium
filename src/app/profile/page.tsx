import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { ProfileTabs } from '@/components/profile/ProfileTabs'
import { VerifyEmailNotice } from '@/components/profile/VerifyEmailNotice'
import { readDisplayTitles, resolvePublicTitleLabel } from '@/lib/displayTitles'
import { publicAppointmentLabel } from '@/lib/teamProfiles'
import { profileEditorState } from '@/lib/profileFields'
import { publicAuthorPath } from '@/lib/authorUtils'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile',
}

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ tab?: string }>
}

const VALID_TABS = ['history', 'reading', 'saved', 'debates', 'comments', 'settings'] as const
type TabId = typeof VALID_TABS[number]

function isValidTab(t: string | undefined): t is TabId {
  return VALID_TABS.includes(t as TabId)
}

export default async function ProfilePage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { tab } = await searchParams
  const initialTab = isValidTab(tab) ? tab : 'history'

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, slug: true, name: true, email: true, image: true, bio: true, createdAt: true, role: true, displayTitles: true, emailVerified: true,
      isActive: true, isBanned: true,
      teamProfile: { select: { name: true, role: true, publicTier: true, bio: true, image: true, isActive: true } },
    },
  }).catch(() => null)

  if (!user) redirect('/login')

  // Name, bio and photo: for a contributor with a linked Team Profile this is that shared profile
  // (the same values the editorial Team Profile shows), otherwise the account's own.
  const editor = profileEditorState(user, user.teamProfile, { testingMode: process.env.TESTING_MODE_ENABLED === '1' })

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {!user.emailVerified && <VerifyEmailNotice email={user.email} />}
      <ProfileTabs
        initialName={editor.view.values.name}
        email={user.email ?? session.user.email ?? ''}
        image={editor.view.values.image}
        createdAt={user.createdAt.toISOString()}
        initialTab={initialTab}
        role={user.role}
        displayTitles={readDisplayTitles(user.displayTitles)}
        fallbackLabel={resolvePublicTitleLabel({
          cardTitle: user.teamProfile?.isActive ? publicAppointmentLabel(user.teamProfile) : null,
        })}
        authorPath={publicAuthorPath(user)}
        editor={editor}
      />
    </div>
  )
}
