import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

function isAdmin(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  if (!session) return false
  const user = (session as { user?: { role?: string; isBanned?: boolean } }).user
  return user?.role === 'ADMIN' && !user?.isBanned
}

interface Ctx { params: Promise<{ userId: string }> }

// GET /api/admin/users/[userId] — full user profile
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await params

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      slug: true, bio: true, image: true, createdAt: true,
      lastLoginAt: true, lastActiveAt: true,
      isBanned: true, bannedAt: true, bannedReason: true, bannedBy: true,
      adminNotes: true,
      _count: {
        select: {
          articles: true, comments: true, warnings: true,
          debateVotes: true, bookmarks: true, readingProgress: true,
        },
      },
      articles: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, slug: true, status: true,
          viewCount: true, createdAt: true, publishedAt: true,
          category: { select: { name: true } },
        },
      },
      comments: {
        where: { isHidden: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, body: true, createdAt: true, upvotes: true, isHidden: true,
          article: { select: { id: true, title: true, slug: true } },
          _count: { select: { upvotedBy: true } },
        },
      },
      debateVotes: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, side: true, createdAt: true,
          debate: { select: { id: true, title: true } },
        },
      },
      warnings: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, reason: true, issuedBy: true, createdAt: true },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, note: true, authorId: true, authorName: true, createdAt: true },
      },
      readingProgress: {
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true, progress: true, completed: true, updatedAt: true,
          article: { select: { id: true, title: true, slug: true } },
        },
      },
    },
  })

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json(user)
}

// DELETE /api/admin/users/[userId] — hard delete
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await params
  const adminId = session!.user.id

  // Cannot delete yourself
  if (userId === adminId) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  const { confirmEmail } = await req.json()

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  })

  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Cannot delete another admin
  if (target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Cannot delete admin accounts' }, { status: 400 })
  }

  if (!confirmEmail || confirmEmail.toLowerCase() !== target.email.toLowerCase()) {
    return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
  }

  const adminName = session!.user.name ?? session!.user.email ?? adminId

  try {
    await prisma.$transaction(async (tx) => {
      await tx.articleNote.deleteMany({ where: { authorId: userId } })
      await tx.article.deleteMany({ where: { authorId: userId } })
      await tx.subscriber.deleteMany({ where: { email: target.email } })
      await tx.loginAttempt.deleteMany({ where: { email: target.email } })
      await tx.user.delete({ where: { id: userId } })
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'USER_DELETED',
        targetId: userId,
        targetType: 'user',
        performedBy: adminId,
        metadata: { deletedEmail: target.email, deletedName: target.name, adminName },
      },
    }).catch(() => {})

    console.log(`[audit] USER_DELETED userId=${userId} email=${target.email} by adminId=${adminId} at ${new Date().toISOString()}`)

    // Notify deleted user
    sendEmail({
      to: target.email,
      subject: 'Your data has been deleted: The Consilium',
      html: `
        <p>Hi${target.name ? ` ${target.name}` : ''},</p>
        <p>Your account and all associated data have been permanently deleted from The Consilium.</p>
        <p>If you believe this was in error, please contact us at theconsilium.editor@gmail.com.</p>
        <p>The Consilium</p>
      `,
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/users/delete]', err)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
