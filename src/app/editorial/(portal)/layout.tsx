import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EditorialSidebar } from '@/components/layout/EditorialSidebar'

const EDITORIAL_ROLES = ['ADMIN', 'EDITOR', 'WRITER']

export default async function EditorialLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/editorial/login')
  }

  // Always read role from the database — never trust the JWT alone.
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

  // Auto-publish any articles whose scheduled time has passed.
  // Runs on every editorial page load so publishing happens promptly
  // without depending solely on the cron job.
  try {
    const now = new Date()
    const due = await prisma.article.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      include: { author: true },
    })
    for (const article of due) {
      await prisma.article.update({
        where: { id: article.id },
        data: { status: 'PUBLISHED', publishedAt: now },
      })
      await prisma.notification.create({
        data: {
          userId: article.authorId,
          type: 'published',
          title: 'Article published',
          message: `Your article "${article.title}" has been published.`,
          articleId: article.id,
        },
      })
    }
  } catch {
    // Never let this block the page
  }

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
      <Suspense fallback={<div className="w-[220px] shrink-0" style={{ background: '#0F1623' }} />}>
        <EditorialSidebar user={verifiedUser} />
      </Suspense>
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
