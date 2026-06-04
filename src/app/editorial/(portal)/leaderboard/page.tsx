import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { EDITORIAL_PORTAL_ROLES, isAllowedRole } from '@/lib/rbac'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { LeaderboardClient } from './LeaderboardClient'

export const metadata: Metadata = {
  title: 'Writer Leaderboard | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function LeaderboardPage() {
  const session = await getServerSession(authOptions)
  // READER role cannot access the leaderboard.
  if (!session || !isAllowedRole(session.user.role, EDITORIAL_PORTAL_ROLES)) {
    redirect('/editorial')
  }

  const userId = session.user.id

  return <LeaderboardClient currentUserId={userId} />
}
