import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AnalyticsDashboard } from './AnalyticsDashboard'

export const metadata: Metadata = {
  title: 'Analytics | Editorial',
  robots: { index: false, follow: false },
}

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions)
  if (!session || !['ADMIN', 'GROWTH'].includes((session.user as { role?: string }).role ?? '')) {
    redirect('/editorial')
  }

  return <AnalyticsDashboard />
}
