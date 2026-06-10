'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import {
  CALENDAR_ACCESS_ROLES,
  GLOSSARY_MANAGE_ROLES,
  PREDICTIONS_MANAGE_ROLES,
  isAllowedRole,
} from '@/lib/rbac'
import {
  CalendarDays,
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
  Pencil,
  Trash2,
  Zap,
  UserCheck,
  Trophy,
  Target,
  BookMarked,
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
  badge?: number
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

export function EditorialSidebar({
  user,
  trashCount = 0,
  onNavClick,
}: {
  user: User
  trashCount?: number
  onNavClick?: () => void
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isEditor = user.role === 'ADMIN' || user.role === 'EDITOR'
  const isAdmin = user.role === 'ADMIN'
  const isGrowth = user.role === 'GROWTH'

  const isActive = (href: string, exact?: boolean) => {
    const [hrefPath, hrefQuery] = href.split('?')
    if (hrefQuery) {
      if (pathname !== hrefPath) return false
      const hrefParams = new URLSearchParams(hrefQuery)
      for (const [key, val] of hrefParams.entries()) {
        if (searchParams.get(key) !== val) return false
      }
      return true
    }
    if (exact) return pathname === hrefPath
    if (hrefPath === '/editorial/articles') {
      if (searchParams.get('mine') === 'true') return false
      return (
        pathname === '/editorial/articles' ||
        (pathname.startsWith('/editorial/articles/') && pathname !== '/editorial/articles/new')
      )
    }
    return pathname.startsWith(hrefPath) && hrefPath !== '/editorial'
  }

  const groups: NavGroup[] = isGrowth
    ? [
        {
          label: 'GROWTH',
          items: [
            { href: '/editorial', icon: LayoutDashboard, label: 'Dashboard', exact: true, show: true },
            { href: '/editorial/analytics', icon: BarChart2, label: 'Analytics', show: true },
            { href: '/editorial/growth/subscribers', icon: UserCheck, label: 'Subscribers', exact: true, show: true },
            { href: '/editorial/growth/engagement', icon: Zap, label: 'Engagement', exact: true, show: true },
          ],
        },
      ]
    : [
        {
          items: [
            { href: '/editorial', icon: LayoutDashboard, label: 'Dashboard', exact: true, show: true },
          ],
        },
        {
          label: 'CONTENT',
          items: [
            { href: '/editorial/articles', icon: FileText, label: user.role === 'WRITER' ? 'My Articles' : 'All Articles', show: true },
            { href: '/editorial/articles?mine=true&status=DRAFT', icon: Pencil, label: 'My Drafts', exact: true, show: true },
            { href: '/editorial/articles/new', icon: PlusCircle, label: 'New Article', exact: true, show: true },
            { href: '/editorial/series', icon: BookOpen, label: 'Article Series', show: isEditor },
            { href: '/editorial/scheduled', icon: Clock, label: 'Scheduled', show: isEditor },
            { href: '/editorial/calendar', icon: CalendarDays, label: 'Calendar', show: isAllowedRole(user.role, CALENDAR_ACCESS_ROLES) },
            { href: '/editorial/trash', icon: Trash2, label: 'Trash', exact: true, show: isEditor, badge: trashCount > 0 ? trashCount : undefined },
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
            { href: '/editorial/users', icon: Users, label: 'Users', show: isAdmin },
            { href: '/editorial/analytics', icon: BarChart2, label: 'Analytics', show: isAdmin },
            { href: '/editorial/predictions', icon: Target, label: 'Predictions', show: isAllowedRole(user.role, PREDICTIONS_MANAGE_ROLES) },
            { href: '/editorial/glossary', icon: BookMarked, label: 'Glossary', show: isAllowedRole(user.role, GLOSSARY_MANAGE_ROLES) },
          ],
        },
        {
          label: 'STANDINGS',
          items: [
            { href: '/editorial/leaderboard', icon: Trophy, label: 'Leaderboard', exact: true, show: user.role === 'WRITER' },
          ],
        },
      ]

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col min-h-screen sticky top-0 h-screen overflow-y-auto overflow-x-hidden"
      style={{ background: '#0F1623' }}
    >
      {/* Masthead */}
      <div className="px-3 pt-5 pb-4 border-b border-white/8 flex items-center gap-3 min-h-[60px]">
        <span
          className="text-gold font-bold text-sm shrink-0 select-none"
          style={{ fontFamily: 'var(--font-serif)' }}
          aria-hidden
        >
          TC
        </span>
        <div
          className={[
            'min-w-0 transition-[opacity,max-width] duration-200 ease-in-out overflow-hidden',
            'md:opacity-0 md:max-w-0',
            'md:group-hover/sidebar:opacity-100 md:group-hover/sidebar:max-w-[160px]',
            'lg:opacity-100 lg:max-w-[160px]',
          ].join(' ')}
        >
          <Link
            href="/"
            className="text-gold font-bold text-sm tracking-widest uppercase whitespace-nowrap block"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Consilium
          </Link>
          <p className="text-cream/25 text-[9px] mt-0.5 uppercase tracking-widest whitespace-nowrap">
            Editorial Portal
          </p>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 py-3 overflow-y-auto" aria-label="Editorial navigation">
        {groups.map((group, gi) => {
          const visibleItems = group.items.filter((i) => i.show)
          if (visibleItems.length === 0) return null
          return (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.label && (
                <p
                  className={[
                    'px-3 mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase text-cream/25',
                    'transition-[opacity,max-height] duration-200',
                    'md:opacity-0 md:max-h-0 md:overflow-hidden',
                    'md:group-hover/sidebar:opacity-100 md:group-hover/sidebar:max-h-8',
                    'lg:opacity-100 lg:max-h-8 lg:overflow-visible',
                  ].join(' ')}
                >
                  {group.label}
                </p>
              )}
              {visibleItems.map((item) => {
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavClick}
                    className={[
                      'flex items-center gap-2.5 px-3 text-[13px] font-medium border-l-2',
                      'min-h-[48px]',
                      'transition-[colors,transform] duration-100 active:scale-[0.97] active:opacity-80',
                      'md:justify-center lg:justify-start md:group-hover/sidebar:justify-start',
                      active
                        ? 'border-gold text-gold'
                        : 'border-transparent text-cream/45 hover:text-cream/80',
                    ].join(' ')}
                  >
                    <item.icon size={15} className="shrink-0" />
                    <span
                      className={[
                        'tracking-wide truncate transition-[opacity,max-width] duration-200 ease-in-out overflow-hidden',
                        'md:opacity-0 md:max-w-0',
                        'md:group-hover/sidebar:opacity-100 md:group-hover/sidebar:max-w-[140px]',
                        'lg:opacity-100 lg:max-w-[140px]',
                      ].join(' ')}
                    >
                      {item.label}
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className={[
                          'ml-auto text-[10px] font-bold bg-gold/20 text-gold px-1.5 py-0.5 rounded-full leading-none shrink-0',
                          'transition-[opacity] duration-200',
                          'md:opacity-0 md:group-hover/sidebar:opacity-100 lg:opacity-100',
                        ].join(' ')}
                      >
                        {item.badge}
                      </span>
                    )}
                    {active && !item.badge && (
                      <ChevronRight
                        size={11}
                        className={[
                          'ml-auto opacity-50 shrink-0',
                          'transition-[opacity] duration-200',
                          'md:hidden md:group-hover/sidebar:block lg:block',
                        ].join(' ')}
                      />
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* User info + logout at bottom */}
      <div className="border-t border-white/8 shrink-0">
        <div className="flex items-center gap-2.5 px-3 py-3 min-h-[52px]">
          <div className="w-7 h-7 rounded-full bg-gold/15 flex items-center justify-center shrink-0">
            <span className="text-gold text-[11px] font-bold">
              {user.name?.charAt(0) ?? user.email?.charAt(0) ?? '?'}
            </span>
          </div>
          <div
            className={[
              'min-w-0 flex-1 transition-[opacity,max-width] duration-200 ease-in-out overflow-hidden',
              'md:opacity-0 md:max-w-0',
              'md:group-hover/sidebar:opacity-100 md:group-hover/sidebar:max-w-[120px]',
              'lg:opacity-100 lg:max-w-[120px]',
            ].join(' ')}
          >
            <p className="text-cream/80 text-[12px] font-medium truncate whitespace-nowrap">
              {user.name ?? user.email}
            </p>
            <p className="text-gold/50 text-[9px] uppercase tracking-widest whitespace-nowrap">
              {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
            </p>
          </div>
          <div
            className={[
              'shrink-0 transition-[opacity] duration-200',
              'md:opacity-0 md:pointer-events-none',
              'md:group-hover/sidebar:opacity-100 md:group-hover/sidebar:pointer-events-auto',
              'lg:opacity-100 lg:pointer-events-auto',
            ].join(' ')}
          >
            <ThemeToggle />
          </div>
        </div>
        <button
          onClick={async () => {
            onNavClick?.()
            await signOut({ callbackUrl: '/editorial/login' })
          }}
          className={[
            'flex items-center gap-2.5 px-3 py-3 text-[12px] text-cream/30 hover:text-cream/60 w-full',
            'border-t border-white/6 min-h-[44px]',
            'transition-[colors,transform] duration-100 active:scale-[0.97]',
            'md:justify-center lg:justify-start md:group-hover/sidebar:justify-start',
          ].join(' ')}
        >
          <LogOut size={13} className="shrink-0" />
          <span
            className={[
              'transition-[opacity,max-width] duration-200 ease-in-out overflow-hidden',
              'md:opacity-0 md:max-w-0',
              'md:group-hover/sidebar:opacity-100 md:group-hover/sidebar:max-w-[120px]',
              'lg:opacity-100 lg:max-w-[120px]',
            ].join(' ')}
          >
            Sign Out
          </span>
        </button>
      </div>
    </aside>
  )
}
