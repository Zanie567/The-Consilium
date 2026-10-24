import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NEWSLETTER_VIEW_ROLES, isAllowedRole } from '@/lib/rbac'

/** Admins, editors and growth may open the newsletter pages; the APIs re-check every action's role. */
export default async function NewsletterLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (!isAllowedRole(session.user.role, NEWSLETTER_VIEW_ROLES)) redirect('/editorial')
  return <>{children}</>
}
