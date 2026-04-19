import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { LeaderboardClient } from './LeaderboardClient'

export const metadata: Metadata = {
  title: 'Writer Leaderboard | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

// READER role cannot access the leaderboard
const LEADERBOARD_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH']

export default async function LeaderboardPage() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string })?.role ?? ''
  if (!session || !LEADERBOARD_ROLES.includes(role)) {
    redirect('/editorial')
  }

  const userId = (session.user as { id?: string })?.id ?? ''

  return <LeaderboardClient currentUserId={userId} />
}
