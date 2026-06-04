'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Menu, X, Search, LayoutDashboard, PlusCircle } from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { usePathname, useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useScrolled } from '@/hooks/useScrolled'
import { isAllowedRole, ARTICLE_MUTATION_ROLES } from '@/lib/rbac'

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/category/news', label: 'News' },
  { href: '/category/opinion', label: 'Opinion' },
  { href: '/category/analysis', label: 'Analysis' },
  { href: '/category/interviews', label: 'Interviews' },
  { href: '/opinion-debate', label: 'Debate' },
  { href: '/about', label: 'About' },
]

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string
  label: string
  active: boolean
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`relative text-xs font-semibold tracking-widest uppercase py-1 transition-[color,transform] duration-100 active:scale-[0.95] active:opacity-75 ${
        active ? 'text-gold' : 'text-cream/70 hover:text-cream'
      }`}
    >
      {label}
      {active && (
        <motion.span
          layoutId="nav-underline"
          className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-gold"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
    </Link>
  )
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { scrolled } = useScrolled(20)
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); setSearchOpen(false) }, [pathname])

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [searchOpen])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  // Trap focus + close on Escape
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen])

  // Editorial portal has its own navigation - don't render the public navbar there
  if (pathname.startsWith('/editorial')) return null

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-out ${
          scrolled
            ? 'bg-navy/[0.85] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.28)] border-b border-gold/20'
            : 'bg-navy border-b-2 border-gold'
        }`}
      >
        <div
          className="w-full h-16 pl-3 pr-4 sm:pl-5 sm:pr-6 lg:pl-7 lg:pr-8 flex items-center justify-between"
        >
          {/* Masthead */}
          <Link
            href="/"
            className="text-gold font-serif font-bold tracking-widest text-xl sm:text-2xl uppercase hover:opacity-85 transition-opacity duration-200 whitespace-nowrap shrink-0"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Consilium
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-10" aria-label="Main navigation">
            {navLinks.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={isActive(link.href)}
              />
            ))}
          </nav>

          {/* Desktop right actions */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => setSearchOpen((o) => !o)}
              aria-label="Search"
              className="text-cream/60 hover:text-gold transition-colors duration-200 p-1"
            >
              <Search size={17} />
            </button>
            <ThemeToggle />
            {session ? (
              <div className="flex items-center gap-3 pl-3 border-l border-navy-light">
                {isAllowedRole(session.user.role, ARTICLE_MUTATION_ROLES) &&
                  !pathname.startsWith('/editorial') &&
                  !pathname.startsWith('/admin') && (
                  <>
                    <Link
                      href="/editorial"
                      className="flex items-center gap-1 text-gold/70 text-[10px] font-semibold uppercase tracking-widest hover:text-gold transition-colors"
                      title="Editorial dashboard"
                    >
                      <LayoutDashboard size={12} />
                      <span>Dashboard</span>
                    </Link>
                    <Link
                      href="/editorial/articles/new"
                      className="flex items-center gap-1 text-gold/70 text-[10px] font-semibold uppercase tracking-widest hover:text-gold transition-colors"
                      title="Write a new article"
                    >
                      <PlusCircle size={12} />
                      <span>New Article</span>
                    </Link>
                  </>
                )}
                <Link
                  href="/profile"
                  className="text-cream/70 text-xs font-semibold uppercase tracking-widest hover:text-cream transition-colors"
                >
                  Profile
                </Link>
                <button
                  onClick={() => signOut()}
                  className="text-cream/50 text-xs hover:text-cream/80 transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="ml-1 text-gold text-xs font-semibold border border-gold/60 px-3 py-1.5 hover:bg-gold hover:text-navy transition-all duration-200 tracking-widest uppercase btn-lift"
              >
                Sign in
              </Link>
            )}
          </div>

          {/* Mobile: search + theme + hamburger */}
          <div className="md:hidden flex items-center gap-1">
            <button
              onClick={() => setSearchOpen((o) => !o)}
              aria-label="Search"
              className="text-cream/60 hover:text-gold transition-colors w-11 h-11 flex items-center justify-center"
            >
              <Search size={17} />
            </button>
            <ThemeToggle />
            <motion.button
              className="text-cream w-11 h-11 flex items-center justify-center hover:text-gold transition-colors"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={mobileOpen ? 'close' : 'open'}
                  initial={prefersReducedMotion ? undefined : { opacity: 0, rotate: -90 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, rotate: 90 }}
                  transition={{ duration: 0.15 }}
                >
                  {mobileOpen ? <X size={22} /> : <Menu size={22} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </header>

      {/* Search overlay */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            key="search-overlay"
            initial={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-14 sm:top-16 inset-x-0 z-40 bg-navy/[0.98] backdrop-blur-md border-b border-gold/30 shadow-[0_16px_32px_rgba(0,0,0,0.4)] py-4 px-4"
          >
            <form onSubmit={handleSearch} className="max-w-2xl mx-auto flex items-center gap-3">
              <Search size={16} className="text-gold/60 shrink-0" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search articles, authors, topics…"
                autoComplete="off"
                className="flex-1 bg-transparent text-cream placeholder-cream/35 text-sm outline-none"
              />
              <button
                type="submit"
                className="text-gold text-xs font-bold uppercase tracking-widest hover:text-gold/70 transition-colors shrink-0"
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="text-cream/40 hover:text-cream transition-colors"
              >
                <X size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile menu - right-side drawer with backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="md:hidden fixed inset-0 z-[55] bg-navy/60 backdrop-blur-sm"
              aria-hidden
              onClick={() => setMobileOpen(false)}
            />

            {/* Drawer panel */}
            <motion.div
              ref={mobileMenuRef}
              key="mobile-menu"
              initial={prefersReducedMotion ? undefined : { x: '100%' }}
              animate={{ x: 0 }}
              exit={prefersReducedMotion ? undefined : { x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              className="md:hidden fixed top-0 right-0 bottom-0 w-72 z-[60] bg-navy border-l border-gold/25 shadow-[-16px_0_40px_rgba(0,0,0,0.45)] overflow-y-auto flex flex-col"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <span
                  className="text-gold font-bold text-sm tracking-widest uppercase"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  The Consilium
                </span>
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="text-cream/50 hover:text-cream transition-colors p-1"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Nav links */}
              <nav className="flex-1 px-5 py-4 flex flex-col gap-0.5" aria-label="Mobile navigation">
                {navLinks.map((link, i) => (
                  <motion.div
                    key={link.href}
                    initial={prefersReducedMotion ? undefined : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 + 0.05, duration: 0.22, ease: 'easeOut' }}
                  >
                    <Link
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block py-3.5 text-sm font-semibold tracking-widest uppercase border-b border-white/8 transition-[color,transform] duration-100 active:scale-[0.97] active:opacity-80 ${
                        isActive(link.href) ? 'text-gold' : 'text-cream/70 hover:text-gold'
                      }`}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>

              {/* Auth footer */}
              <div className="px-5 py-4 border-t border-white/10 flex flex-col gap-3">
                {session && isAllowedRole(session.user.role, ARTICLE_MUTATION_ROLES) && (
                  <div className="flex items-center gap-4 pb-3 border-b border-white/10">
                    <Link
                      href="/editorial"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-1.5 text-gold/80 text-xs font-semibold uppercase tracking-widest hover:text-gold transition-colors"
                    >
                      <LayoutDashboard size={13} />
                      <span>Dashboard</span>
                    </Link>
                    <Link
                      href="/editorial/articles/new"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-1.5 text-gold/80 text-xs font-semibold uppercase tracking-widest hover:text-gold transition-colors"
                    >
                      <PlusCircle size={13} />
                      <span>New Article</span>
                    </Link>
                  </div>
                )}
                <div className="flex items-center gap-4">
                {session ? (
                  <>
                    <Link
                      href="/profile"
                      onClick={() => setMobileOpen(false)}
                      className="text-cream/70 text-sm font-semibold uppercase tracking-widest hover:text-cream transition-colors"
                    >
                      Profile
                    </Link>
                    <button
                      onClick={() => { signOut(); setMobileOpen(false) }}
                      className="text-cream/50 text-sm hover:text-cream/80 transition-colors"
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <Link
                    href="/login"
                    onClick={() => setMobileOpen(false)}
                    className="text-gold text-sm font-semibold border border-gold/50 px-4 py-2 uppercase tracking-widest hover:bg-gold hover:text-navy transition-all duration-200"
                  >
                    Sign in
                  </Link>
                )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
