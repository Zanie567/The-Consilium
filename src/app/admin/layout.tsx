import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AdminSidebar } from '@/components/layout/AdminSidebar'

const ALLOWED_ROLES = ['ADMIN', 'EDITOR', 'WRITER']

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/editorial/login')
  }

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    redirect('/editorial/login')
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex">
      <AdminSidebar user={session.user} />
      <main className="flex-1 min-w-0 p-6 lg:p-8">{children}</main>
    </div>
  )
}
