'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  LogOut,
  ChevronRight,
  Users,
  ClipboardList,
  BookOpen,
  Clock,
  BarChart2,
  MessagesSquare,
  MessageCircle,
} from 'lucide-react'

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
  role: string
}

interface NavItem {
  href: string
  icon: React.ElementType
  label: string
  exact?: boolean
  show: boolean
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

export function EditorialSidebar({ user }: { user: User }) {
  const pathname = usePathname()

  const isEditor = user.role === 'ADMIN' || user.role === 'EDITOR'
  const isAdmin = user.role === 'ADMIN'

  const groups: NavGroup[] = [
    {
      items: [
        { href: '/editorial', icon: LayoutDashboard, label: 'Dashboard', exact: true, show: true },
      ],
    },
    {
      label: 'CONTENT',
      items: [
        { href: '/editorial/articles', icon: FileText, label: user.role === 'WRITER' ? 'My Articles' : 'All Articles', show: true },
        { href: '/editorial/articles/new', icon: PlusCircle, label: 'New Article', show: true },
        { href: '/editorial/series', icon: BookOpen, label: 'Article Series', show: isEditor },
        { href: '/editorial/scheduled', icon: Clock, label: 'Scheduled', show: isEditor },
      ],
    },
    {
      label: 'REVIEW',
      items: [
        { href: '/editorial/review', icon: ClipboardList, label: 'Review Queue', show: isEditor },
        { href: '/editorial/debates', icon: MessagesSquare, label: 'Debates', show: isEditor },
        { href: '/editorial/comments', icon: MessageCircle, label: 'Comments', show: isEditor },
      ],
    },
    {
      label: 'MANAGE',
      items: [
        { href: '/editorial/users', icon: Users, label: 'Users', show: isEditor },
        { href: '/editorial/analytics', icon: BarChart2, label: 'Analytics', show: isAdmin },
      ],
    },
  ]

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href) && href !== '/editorial'
  }

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col min-h-screen sticky top-0 h-screen overflow-y-auto"
      style={{ background: '#0F1623' }}
    >
      {/* Masthead */}
      <div className="px-5 pt-5 pb-4 border-b border-white/8">
        <Link
          href="/"
          className="text-gold font-bold text-sm tracking-widest uppercase"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          The Consilium
        </Link>
        <p className="text-cream/25 text-[9px] mt-0.5 uppercase tracking-widest">Editorial Portal</p>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 py-3 overflow-y-auto" aria-label="Editorial navigation">
        {groups.map((group, gi) => {
          const visibleItems = group.items.filter((i) => i.show)
          if (visibleItems.length === 0) return null
          return (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.label && (
                <p className="px-4 mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase text-cream/25">
                  {group.label}
                </p>
              )}
              {visibleItems.map((item) => {
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium transition-colors duration-150 border-l-2 ${
                      active
                        ? 'border-gold text-gold'
                        : 'border-transparent text-cream/45 hover:text-cream/80'
                    }`}
                  >
                    <item.icon size={14} className="shrink-0" />
                    <span className="tracking-wide">{item.label}</span>
                    {active && <ChevronRight size={11} className="ml-auto opacity-50" />}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* User info + logout at bottom */}
      <div className="border-t border-white/8">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div className="w-7 h-7 rounded-full bg-gold/15 flex items-center justify-center shrink-0">
            <span className="text-gold text-[11px] font-bold">
              {user.name?.charAt(0) ?? user.email?.charAt(0) ?? '?'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-cream/80 text-[12px] font-medium truncate">
              {user.name ?? user.email}
            </p>
            <p className="text-gold/50 text-[9px] uppercase tracking-widest">
              {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
            </p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/editorial/login' })}
          className="flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-cream/30 hover:text-cream/60 w-full transition-colors border-t border-white/6"
        >
          <LogOut size={13} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
