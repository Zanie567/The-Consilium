import { getVerifiedSessionUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AnalyticsDashboard } from './AnalyticsDashboard'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'

export const metadata: Metadata = {
  title: 'Analytics | Editorial',
  robots: { index: false, follow: false },
}

export default async function AnalyticsPage() {
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) {
    redirect('/editorial')
  }

  return <AnalyticsDashboard userRole={user.role} />
}
