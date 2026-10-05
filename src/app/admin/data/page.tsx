import { redirect } from 'next/navigation'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { DataManagement } from '@/components/admin/DataManagement'
export default async function DataManagementPage() {
  if (!await getVerifiedSessionUser(ADMIN_ONLY)) redirect('/editorial')
  return <DataManagement />
}
