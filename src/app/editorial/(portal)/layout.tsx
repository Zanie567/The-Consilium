import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EditorialSidebarWrapper } from '@/components/layout/EditorialSidebarWrapper'
import { PortalTransition } from '@/components/editorial/PortalTransition'

const EDITORIAL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH']

export default async function EditorialLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/editorial/login')
  }

  // Always read role from the database - never trust the JWT alone.
  // This ensures role changes and new accounts take effect immediately.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true, name: true, email: true, image: true },
  }).catch(() => null)

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
    <div className="min-h-screen bg-[var(--bg-subtle)] flex">
      {/* Sidebar: hidden on mobile (overlay via wrapper), always visible on desktop */}
      <Suspense fallback={<div className="hidden md:block w-[220px] shrink-0" style={{ background: '#0F1623' }} />}>
        <EditorialSidebarWrapper user={verifiedUser} trashCount={trashCount} />
      </Suspense>
      {/* Main content wrapped in page-transition component */}
      <main className="flex-1 min-w-0 overflow-auto">
        <PortalTransition>{children}</PortalTransition>
      </main>
    </div>
  )
}
