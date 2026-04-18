'use client'

import { useState, useEffect } from 'react'
import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { EditorialSidebar } from './EditorialSidebar'

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
  role: string
}

export function EditorialSidebarWrapper({ user }: { user: User }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <>
      {/* Mobile hamburger — only visible below md (768px) */}
      <button
        className="md:hidden fixed top-3.5 left-3.5 z-[80] w-9 h-9 flex items-center justify-center rounded-md text-cream/70 hover:text-gold transition-colors"
        style={{ background: '#0F1623', boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={18} />
      </button>

      {/* Backdrop — only on mobile */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/*
        Sidebar container:
        - Mobile: fixed overlay, slides in/out from the left
        - Desktop (md+): relative flex child, always visible, no transform
      */}
      <div
        className={[
          'fixed inset-y-0 left-0 z-[75] flex',
          'md:relative md:inset-auto md:z-auto md:flex md:shrink-0',
          'transition-transform duration-300 ease-out will-change-transform',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        <EditorialSidebar
          user={user}
          onNavClick={() => setMobileOpen(false)}
        />
      </div>
    </>
  )
}
