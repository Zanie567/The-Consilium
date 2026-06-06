import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { CONTACT_EMAIL } from '@/lib/constants'
import { ADMIN_ONLY } from '@/lib/rbac'
import { escapeHtml } from '@/lib/escapeHtml'

export async function POST(req: NextRequest) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const email = body.email
  const checkOnly = body.checkOnly === true

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (!user) {
    return NextResponse.json({ error: 'No account found with that email address.' }, { status: 404 })
  }

  // Never delete another admin through this route (mirrors the [userId] DELETE guard).
  if (user.role === 'ADMIN') {
    return NextResponse.json({ error: 'Cannot delete Admin accounts.' }, { status: 403 })
  }

  // checkOnly: just confirm the user exists, don't delete
  if (checkOnly) {
    return NextResponse.json({ ok: true, found: true })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read the target inside the transaction and re-check the ADMIN guard, so
      // the authorization decision, audit metadata and the delete are consistent
      // — no TOCTOU window between the outer lookup and the destructive write.
      const target = await tx.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, name: true, role: true },
      })
      if (!target) {
        return { error: 'No account found with that email address.', status: 404 } as const
      }
      if (target.role === 'ADMIN') {
        return { error: 'Cannot delete Admin accounts.', status: 403 } as const
      }

      // Record the deletion atomically with the delete itself, so this destructive
      // action can never commit without an audit-log entry.
      await tx.auditLog.create({
        data: {
          action: 'USER_DELETED',
          targetId: target.id,
          targetType: 'user',
          performedBy: admin.id,
          metadata: { targetEmail: target.email, targetName: target.name, targetRole: target.role },
        },
      })

      // Remove notes authored by this user on any article
      await tx.articleNote.deleteMany({ where: { authorId: target.id } })

      // Remove all articles by this user (cascades: bookmarks, views, reading progress, tags)
      await tx.article.deleteMany({ where: { authorId: target.id } })

      // Remove newsletter subscription
      await tx.subscriber.deleteMany({ where: { email: target.email } })

      // Remove login attempt history
      await tx.loginAttempt.deleteMany({ where: { email: target.email } })

      // Delete the user record (cascades: accounts, sessions, bookmarks, notifications,
      // passwordResetTokens, categoryAssignments, readingProgress)
      await tx.user.delete({ where: { id: target.id } })

      return { deleted: target } as const
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Send confirmation to the deleted address
    await sendEmail({
      to: result.deleted.email,
      subject: 'Your data has been deleted: The Consilium',
      html: `
        <p>Hi${result.deleted.name ? ` ${escapeHtml(result.deleted.name)}` : ''},</p>
        <p>This is to confirm that your account and all associated personal data have been permanently deleted from The Consilium.</p>
        <p>This includes your account details, reading history, bookmarks, and any newsletter subscriptions.</p>
        <p>If you did not request this deletion, please contact us at ${CONTACT_EMAIL}.</p>
        <p>The Consilium</p>
      `,
    })

    return NextResponse.json({ ok: true, deletedEmail: result.deleted.email })
  } catch (error) {
    console.error('User deletion error:', error)
    return NextResponse.json({ error: 'Failed to delete user. Please try again.' }, { status: 500 })
  }
}
