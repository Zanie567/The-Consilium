import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EditorialSidebarWrapper } from '@/components/layout/EditorialSidebarWrapper'
import { PortalTransition } from '@/components/editorial/PortalTransition'
import type { Metadata } from 'next'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'

const EDITORIAL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH']

// Everything under this layout is gated. Declaring it once here means a new
// page cannot forget it — several already had, and were inheriting the root
// layout's `index: true`. A page may still override this.
export const metadata: Metadata = { robots: NOINDEX_NOFOLLOW_ROBOTS }

export default async function EditorialLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/editorial/login')
  }

  // Always read role from the database - never trust the JWT alone.
  // This ensures role changes and new accounts take effect immediately.
  const dbUser = await prisma.user
    .findUnique({
      where: { id: session.user.id },
      select: { role: true, isActive: true, name: true, email: true, image: true },
    })
    .catch(() => null)

  if (!dbUser || !dbUser.isActive || !EDITORIAL_ROLES.includes(dbUser.role)) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-gold/40 text-xs tracking-[0.4em] uppercase mb-4">403</p>
          <h1
            className="text-3xl font-bold text-gold mb-3"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Access Denied
          </h1>
          <p className="text-cream/50 text-sm leading-relaxed">
            You do not have permission to access the editorial system.
          </p>
        </div>
      </div>
    )
  }

  // Fetch trash count for the sidebar badge (admin/editor only)
  const isEditorOrAdmin = dbUser.role === 'ADMIN' || dbUser.role === 'EDITOR'
  const trashCount = isEditorOrAdmin
    ? await prisma.article.count({ where: { deletedAt: { not: null } } }).catch(() => 0)
    : 0
  // Build a user object using the verified DB role
  const verifiedUser = {
    id: session.user.id,
    name: dbUser.name,
    email: dbUser.email,
    image: dbUser.image,
    role: dbUser.role,
  }

  return (
    // Bounded app shell. The portal is pinned to the viewport (100dvh, not
    // 100vh, so mobile browser chrome cannot push the sign-out button off
    // screen) and only the content region below scrolls. Previously the whole
    // document scrolled, which carried the sidebar off the top of the screen
    // on any page taller than the viewport.
    <div className="h-[100dvh] bg-[var(--bg-subtle)] flex overflow-hidden">
      {/* Sidebar: hidden on mobile (overlay via wrapper), always visible on desktop */}
      <Suspense
        fallback={
          <div className="hidden md:block w-[220px] shrink-0" style={{ background: '#0F1623' }} />
        }
      >
        <EditorialSidebarWrapper user={verifiedUser} trashCount={trashCount} />
      </Suspense>
      {/*
       * The portal's only scroll region. A plain div, not <main>: the root
       * layout already renders <main id="main-content"> around all children,
       * and nesting a second <main> is invalid and confuses screen readers.
       *
       * overflow-auto on both axes, deliberately. Bounding the height is the
       * point of this change; the x axis stays `auto` (as it was) because a
       * few pages still run a little wide at ~390px, and clipping that content
       * would make it unreachable. A scrollbar inside this region is contained
       * and never becomes a browser-level horizontal scrollbar.
       */}
      <div className="flex-1 min-w-0 overflow-auto">
        <PortalTransition>{children}</PortalTransition>
      </div>
    </div>
  )
}
