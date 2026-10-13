import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { PlusCircle } from 'lucide-react'
import type { Metadata } from 'next'
import { authOptions } from '@/lib/auth'
import type { DebateAdminRow } from '@/lib/debateAdmin'
import { loadDebateAdminRows } from '@/lib/debateAdminQueries'
import { DebateAdminList } from '@/components/admin/DebateAdminList'

export const metadata: Metadata = {
  title: 'Debates | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function DebatesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user || !['ADMIN', 'EDITOR'].includes(session.user.role ?? '')) {
    redirect('/editorial/login')
  }
  const isAdmin = session.user.role === 'ADMIN'

  let rows: DebateAdminRow[] = []
  let loadFailed = false
  try {
    rows = await loadDebateAdminRows()
  } catch {
    loadFailed = true
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 sm:mb-8 pl-10 md:pl-0">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            Debates
          </h1>
          <p className="text-[var(--fg-faint)] text-sm mt-1">
            Publish, hide, restore and remove debates. Hiding a debate also hides both of its articles.
          </p>
        </div>
        <Link
          href="/editorial/debates/new"
          className="flex items-center gap-2 bg-navy text-cream text-xs font-bold uppercase tracking-widest px-3 sm:px-5 py-2.5 hover:bg-navy/90 transition-colors min-h-[44px]"
        >
          <PlusCircle size={14} />
          <span className="hidden sm:inline">New Debate</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {loadFailed ? (
        <p role="alert" className="text-sm text-red-500">
          The debate list could not be loaded. Reload to try again. If it persists, the database schema may be missing the debate lifecycle migration.
        </p>
      ) : (
        <DebateAdminList initialRows={rows} canManage={isAdmin} />
      )}
    </div>
  )
}
