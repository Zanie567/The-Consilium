import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AdminSidebar } from '@/components/layout/AdminSidebar'
import type { Metadata } from 'next'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'

const ALLOWED_ROLES = ['ADMIN', 'EDITOR', 'WRITER']

// Everything under this layout is gated. Declaring it once here means a new
// page cannot forget it — several already had, and were inheriting the root
// layout's `index: true`. A page may still override this.
export const metadata: Metadata = { robots: NOINDEX_NOFOLLOW_ROBOTS }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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
