import { getVerifiedSessionUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { TeamManagement } from '@/components/admin/TeamManagement'
import type { Metadata } from 'next'
import { ADMIN_ONLY } from '@/lib/rbac'

export const metadata: Metadata = { title: 'Team | Admin' }

export default async function AdminTeamPage() {
  const user = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!user) {
    redirect('/editorial')
  }

  const members = await prisma.teamMember.findMany({ orderBy: { order: 'asc' } }).catch(() => [])

  const accounts = await prisma.user
    .findMany({
      where: { role: { in: ['WRITER', 'EDITOR', 'GROWTH'] }, isActive: true, isBanned: false },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    })
    .catch(() => [])

  return (
    <div>
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-navy"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Team Management
        </h1>
        <p className="text-navy/50 text-sm mt-1">
          Manage team members displayed on the website
        </p>
      </div>
      <TeamManagement initialMembers={members} accounts={accounts} />
    </div>
  )
}
