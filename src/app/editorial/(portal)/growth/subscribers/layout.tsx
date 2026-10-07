import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ANALYTICS_ACCESS_ROLES, isAllowedRole } from '@/lib/rbac'

/**
 * The subscriber list is a client page that fetches /api/editorial/growth/subscribers,
 * which already refuses everyone except Admin and Growth. The page itself had no check,
 * so a writer or editor who typed the URL got the page shell and an error state. Refuse
 * them here, the same way the sibling Growth pages do.
 */
export default async function SubscribersLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (!isAllowedRole(session.user.role, ANALYTICS_ACCESS_ROLES)) redirect('/editorial')
  return <>{children}</>
}
