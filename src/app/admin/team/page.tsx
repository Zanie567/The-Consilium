import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { TeamManagement } from '@/components/admin/TeamManagement'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Team | Admin' }

export default async function AdminTeamPage() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    redirect('/editorial')
  }

  const members = await prisma.teamMember.findMany({ orderBy: { order: 'asc' } }).catch(() => [])

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
      <TeamManagement initialMembers={members} />
    </div>
  )
}
