'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  LayoutDashboard,
  FileText,
  Users,
  Mail,
  PlusCircle,
  LogOut,
  ChevronRight,
} from 'lucide-react'

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
  role: string
}

interface AdminSidebarProps {
  user: User
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname()

  const navItems = [
    { href: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { href: '/admin/articles', icon: FileText, label: 'Articles' },
    { href: '/admin/articles/new', icon: PlusCircle, label: 'New Article' },
    ...(user.role === 'ADMIN' || user.role === 'EDITOR'
      ? [
          { href: '/admin/team', icon: Users, label: 'Team' },
          { href: '/admin/subscribers', icon: Mail, label: 'Subscribers' },
        ]
      : []),
  ]

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href) && href !== '/admin'
  }

  return (
    <aside className="w-64 bg-navy shrink-0 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-navy-light">
        <Link
          href="/"
          className="text-gold font-bold text-lg tracking-widest uppercase"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          The Consilium
        </Link>
        <p className="text-cream/40 text-xs mt-1">Admin Panel</p>
      </div>

      {/* User */}
      <div className="px-6 py-4 border-b border-navy-light">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
            <span className="text-gold text-xs font-bold">
              {user.name?.charAt(0) ?? user.email?.charAt(0) ?? '?'}
            </span>
          </div>
          <div>
            <p className="text-cream text-xs font-medium truncate max-w-[130px]">
              {user.name ?? user.email}
            </p>
            <p className="text-gold text-xs opacity-70 uppercase tracking-wide">
              {user.role.toLowerCase()}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item.href, item.exact)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 text-sm rounded-sm transition-colors ${
                active
                  ? 'bg-gold/10 text-gold border-l-2 border-gold'
                  : 'text-cream/60 hover:text-cream hover:bg-white/5'
              }`}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
              {active && <ChevronRight size={14} className="ml-auto" />}
            </Link>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="p-4 border-t border-navy-light">
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex items-center gap-3 px-3 py-2.5 text-sm text-cream/50 hover:text-cream w-full transition-colors"
        >
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
