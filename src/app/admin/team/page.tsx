import { redirect } from 'next/navigation'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'

// Public profile management now lives in Team Members (account, role and profile in one place).
// This URL is kept so old bookmarks and links still land on the right screen.
export default async function AdminTeamPage() {
  const user = await getVerifiedSessionUser(ADMIN_ONLY)
  redirect(user ? '/editorial/members' : '/editorial')
}
