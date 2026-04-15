import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { ProfileTabs } from '@/components/profile/ProfileTabs'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile | The Consilium',
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
    select: { name: true, email: true, image: true, bio: true, createdAt: true, role: true },
  }).catch(() => null)

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <ProfileTabs
        initialName={user.name}
        initialBio={user.bio}
        email={user.email ?? session.user.email ?? ''}
        image={user.image}
        createdAt={user.createdAt.toISOString()}
        initialTab={initialTab}
        role={user.role}
      />
    </div>
  )
}
