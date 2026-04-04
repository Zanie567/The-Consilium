'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Menu, X } from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useScrolled } from '@/hooks/useScrolled'

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/category/news', label: 'News' },
  { href: '/category/opinion', label: 'Opinion' },
  { href: '/category/analysis', label: 'Analysis' },
  { href: '/category/interviews', label: 'Interviews' },
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
      className={`relative text-xs font-semibold tracking-widest uppercase py-1 transition-colors duration-200 ${
        active ? 'text-gold' : 'text-cream/70 hover:text-cream'
      }`}
    >
      {label}
      {active && (
        <motion.span
          layoutId="nav-underline"
          className="absolute -bottom-0.5 left-0 right-0 h-px bg-gold"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
    </Link>
  )
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { scrolled } = useScrolled(16)
  const { data: session } = useSession()
  const pathname = usePathname()
  const prefersReducedMotion = useReducedMotion()
  const mobileMenuRef = useRef<HTMLDivElement>(null)

  // Close mobile menu on route change
  useEffect(() => setMobileOpen(false), [pathname])

  // Trap focus + close on Escape
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen])

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ease-out ${
          scrolled
            ? 'bg-navy/[0.97] backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.28)] border-b border-gold/30'
            : 'bg-navy border-b-2 border-gold'
        }`}
      >
        <div
          className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between transition-all duration-300 ${
            scrolled ? 'h-14' : 'h-16'
          }`}
        >
          {/* Masthead */}
          <Link
            href="/"
            className="text-gold font-serif font-bold tracking-widest text-xl sm:text-2xl uppercase hover:opacity-85 transition-opacity duration-200"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            The Consilium
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-7" aria-label="Main navigation">
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
            <ThemeToggle />
            {session ? (
              <div className="flex items-center gap-3 pl-3 border-l border-navy-light">
                {(session.user.role === 'ADMIN' || session.user.role === 'EDITOR' || session.user.role === 'WRITER') && (
                  <Link
                    href="/editorial"
                    className="text-gold/70 text-xs font-semibold uppercase tracking-widest hover:text-gold transition-colors"
                  >
                    Editorial
                  </Link>
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

          {/* Mobile: theme + hamburger */}
          <div className="md:hidden flex items-center gap-2">
            <ThemeToggle />
            <motion.button
              className="text-cream p-2 hover:text-gold transition-colors"
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

      {/* Mobile menu — rendered outside header so it can slide down cleanly */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            ref={mobileMenuRef}
            key="mobile-menu"
            initial={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="md:hidden fixed top-14 sm:top-16 inset-x-0 z-40 bg-navy/[0.98] backdrop-blur-md border-b-2 border-gold/40 shadow-[0_16px_32px_rgba(0,0,0,0.4)]"
          >
            <nav
              className="max-w-7xl mx-auto px-4 py-5 flex flex-col gap-1"
              aria-label="Mobile navigation"
            >
              {navLinks.map((link, i) => (
                <motion.div
                  key={link.href}
                  initial={prefersReducedMotion ? undefined : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.2 }}
                >
                  <Link
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block py-2.5 text-sm font-semibold tracking-widest uppercase border-b border-navy-light transition-colors duration-150 ${
                      isActive(link.href)
                        ? 'text-gold'
                        : 'text-cream/75 hover:text-gold'
                    }`}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}

              <div className="pt-3 flex items-center gap-4">
                {session ? (
                  <>
                    <Link
                      href="/profile"
                      onClick={() => setMobileOpen(false)}
                      className="text-cream/70 text-sm font-semibold uppercase tracking-widest hover:text-cream transition-colors"
                    >
                      Profile
                    </Link>
                    <Link
                      href="/editorial"
                      onClick={() => setMobileOpen(false)}
                      className="text-gold/70 text-sm font-semibold uppercase tracking-widest hover:text-gold transition-colors"
                    >
                      Editorial
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
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
