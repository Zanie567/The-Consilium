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
} from 'lucide-react'

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
  role: string
}

export function EditorialSidebar({ user }: { user: User }) {
  const pathname = usePathname()

  const isEditor = user.role === 'ADMIN' || user.role === 'EDITOR'
  const isAdmin = user.role === 'ADMIN'

  const navItems = [
    { href: '/editorial', icon: LayoutDashboard, label: 'Dashboard', exact: true, show: true },
    { href: '/editorial/review', icon: ClipboardList, label: 'Review Queue', exact: false, show: isEditor },
    { href: '/editorial/articles', icon: FileText, label: user.role === 'WRITER' ? 'My Articles' : 'All Articles', show: true },
    { href: '/editorial/articles/new', icon: PlusCircle, label: 'New Article', show: true },
    { href: '/editorial/series', icon: BookOpen, label: 'Article Series', show: isEditor },
    { href: '/editorial/users', icon: Users, label: 'Users', show: isAdmin },
  ]

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href) && href !== '/editorial'
  }

  return (
    <aside className="w-60 bg-navy shrink-0 flex flex-col min-h-screen sticky top-0 h-screen overflow-y-auto">
      <div className="p-5 border-b border-white/10">
        <Link
          href="/"
          className="text-gold font-bold text-base tracking-widest uppercase"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          The Consilium
        </Link>
        <p className="text-cream/30 text-[10px] mt-0.5 uppercase tracking-widest">Editorial Portal</p>
      </div>

      <div className="px-5 py-3.5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center shrink-0">
            <span className="text-gold text-xs font-bold">
              {user.name?.charAt(0) ?? user.email?.charAt(0) ?? '?'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-cream text-xs font-semibold truncate">
              {user.name ?? user.email}
            </p>
            <p className="text-gold/60 text-[10px] uppercase tracking-widest">
              {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.filter((i) => i.show).map((item) => {
          const active = isActive(item.href, item.exact)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-150 ${
                active
                  ? 'bg-gold/10 text-gold border-l-2 border-gold pl-[10px]'
                  : 'text-cream/55 hover:text-cream hover:bg-white/5 border-l-2 border-transparent pl-[10px]'
              }`}
            >
              <item.icon size={15} />
              <span className="text-xs font-medium tracking-wide">{item.label}</span>
              {active && <ChevronRight size={12} className="ml-auto opacity-60" />}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t border-white/10">
        <button
          onClick={() => signOut({ callbackUrl: '/editorial/login' })}
          className="flex items-center gap-3 px-3 py-2.5 text-xs text-cream/40 hover:text-cream/80 w-full transition-colors"
        >
          <LogOut size={15} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
