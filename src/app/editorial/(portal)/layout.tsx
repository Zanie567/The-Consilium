import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { EditorialSidebar } from '@/components/layout/EditorialSidebar'

const EDITORIAL_ROLES = ['ADMIN', 'EDITOR', 'WRITER']

export default async function EditorialLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/editorial/login')
  }

  if (!EDITORIAL_ROLES.includes(session.user.role)) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-gold/40 text-xs tracking-[0.4em] uppercase mb-4">403</p>
          <h1
            className="text-3xl font-bold text-gold mb-3"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Access Denied
          </h1>
          <p className="text-cream/50 text-sm leading-relaxed">
            You do not have permission to access the editorial system.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-subtle)] flex">
      <EditorialSidebar user={session.user} />
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
