'use client'

import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { LayoutDashboard, PlusCircle } from 'lucide-react'

/**
 * A small persistent bar at the top-right for logged-in editorial users.
 * Shown in the public site layout only; editorial portal has its own sidebar.
 */
export function EditorialBar() {
  const { data: session } = useSession()

  if (!session) return null
  const role = (session.user as { role?: string }).role
  if (!role || !['ADMIN', 'EDITOR', 'WRITER'].includes(role)) return null

  return (
    <div className="fixed top-[4.5rem] right-4 z-[80] flex items-center gap-1 bg-navy border border-gold/30 shadow-lg px-2 py-1.5">
      <Link
        href="/editorial"
        className="flex items-center gap-1.5 text-gold text-[10px] font-bold uppercase tracking-widest px-2 py-1 hover:bg-gold/10 transition-colors"
        title="Editorial dashboard"
      >
        <LayoutDashboard size={12} />
        <span className="hidden sm:inline">Dashboard</span>
      </Link>
      <div className="w-px h-4 bg-gold/20" />
      <Link
        href="/editorial/articles/new"
        className="flex items-center gap-1.5 text-gold text-[10px] font-bold uppercase tracking-widest px-2 py-1 hover:bg-gold/10 transition-colors"
        title="Write a new article"
      >
        <PlusCircle size={12} />
        <span className="hidden sm:inline">New Article</span>
      </Link>
    </div>
  )
}
