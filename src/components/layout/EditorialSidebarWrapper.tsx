'use client'

import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { EditorialSidebar } from './EditorialSidebar'

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
  role: string
}

export function EditorialSidebarWrapper({ user, trashCount = 0 }: { user: User; trashCount?: number }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when mobile overlay is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  return (
    <>
      {/*
       * Mobile hamburger button - visible below md (768px).
       * Animates between ☰ and ✕ icons with a rotation/fade crossfade.
       */}
      <button
        className="md:hidden fixed top-3.5 left-3.5 z-[80] w-9 h-9 flex items-center justify-center rounded-md text-cream/70 hover:text-gold transition-colors active:scale-[0.92] transition-transform"
        style={{ background: '#0F1623', boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileOpen}
      >
        {/* Hamburger icon - fades out and rotates when open */}
        <span
          className="absolute inset-0 flex items-center justify-center transition-all duration-200 ease-in-out"
          style={{
            opacity: mobileOpen ? 0 : 1,
            transform: mobileOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
          aria-hidden
        >
          <Menu size={18} />
        </span>
        {/* X icon - fades in and un-rotates when open */}
        <span
          className="absolute inset-0 flex items-center justify-center transition-all duration-200 ease-in-out"
          style={{
            opacity: mobileOpen ? 1 : 0,
            transform: mobileOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
          aria-hidden
        >
          <X size={18} />
        </span>
      </button>

      {/*
       * Backdrop - always mounted for smooth fade.
       * pointer-events-none when closed so clicks fall through.
       */}
      <div
        className="md:hidden fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm transition-opacity duration-300"
        style={{
          opacity: mobileOpen ? 1 : 0,
          pointerEvents: mobileOpen ? 'auto' : 'none',
        }}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />

      {/*
       * Sidebar container:
       *
       * MOBILE (< md = 768px):
       *   Fixed overlay; slides left (-100%) → 0 on open.
       *   Cubic-bezier(0.4, 0, 0.2, 1) - Material Design standard easing.
       *
       * TABLET (md → lg = 768-1023px):
       *   Relative in-flow element.
       *   Collapsed to 48px wide (icon rail); expands to 220px on hover.
       *   Width transitions at 200ms ease.
       *   Nav labels fade in as the rail expands (via group-hover/sidebar).
       *
       * DESKTOP (≥ lg = 1024px):
       *   Always full 220px - no rail behaviour.
       */}
      <div
        className={[
          // Mobile: fixed overlay
          'fixed inset-y-0 left-0 z-[75] flex',
          // Desktop: in-flow
          'md:relative md:inset-auto md:z-auto md:flex md:shrink-0',
          // Mobile slide transform
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          // Tablet rail widths (lg always overrides to 220px)
          'md:w-12 lg:!w-[220px]',
          // Hover expands rail on md; at lg the width is already 220px so has no visible effect
          'md:hover:w-[220px]',
          // Transitions: transform (mobile) + width (tablet rail)
          'transition-[transform,width]',
          'duration-300 md:duration-200',
          'ease-[cubic-bezier(0.4,0,0.2,1)]',
          'will-change-transform',
          // Named group so child elements can react to hover
          'group/sidebar',
          // Overflow hidden so labels don't bleed outside collapsed rail
          'overflow-hidden',
        ].join(' ')}
      >
        <EditorialSidebar
          user={user}
          trashCount={trashCount}
          onNavClick={() => setMobileOpen(false)}
        />
      </div>
    </>
  )
}
