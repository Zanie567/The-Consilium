import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string }).role !== 'ADMIN') {
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

  // checkOnly: just confirm the user exists, don't delete
  if (checkOnly) {
    return NextResponse.json({ ok: true, found: true })
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Remove notes authored by this user on any article
      await tx.articleNote.deleteMany({ where: { authorId: user.id } })

      // Remove all articles by this user (cascades: bookmarks, views, reading progress, tags)
      await tx.article.deleteMany({ where: { authorId: user.id } })

      // Remove newsletter subscription
      await tx.subscriber.deleteMany({ where: { email: user.email } })

      // Remove login attempt history
      await tx.loginAttempt.deleteMany({ where: { email: user.email } })

      // Delete the user record (cascades: accounts, sessions, bookmarks, notifications,
      // passwordResetTokens, categoryAssignments, readingProgress)
      await tx.user.delete({ where: { id: user.id } })
    })

    // Send confirmation to the deleted address
    await sendEmail({
      to: user.email,
      subject: 'Your data has been deleted: The Consilium',
      html: `
        <p>Hi${user.name ? ` ${user.name}` : ''},</p>
        <p>This is to confirm that your account and all associated personal data have been permanently deleted from The Consilium.</p>
        <p>This includes your account details, reading history, bookmarks, and any newsletter subscriptions.</p>
        <p>If you did not request this deletion, please contact us at theconsilium.editor@gmail.com.</p>
        <p>The Consilium</p>
      `,
    })

    return NextResponse.json({ ok: true, deletedEmail: user.email })
  } catch (error) {
    console.error('User deletion error:', error)
    return NextResponse.json({ error: 'Failed to delete user. Please try again.' }, { status: 500 })
  }
}
