import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, verifyEmailEmail } from '@/lib/email'
import { createEmailVerificationToken } from '@/lib/emailVerification'
import { checkRateLimit } from '@/lib/rate-limit'

// POST /api/auth/verify-email/request: email the signed-in account a confirmation
// link. The address is read from the account row for the verified session, never from
// the request, so this cannot be pointed at someone else's inbox.
export async function POST() {
  const auth = await requireVerifiedSessionUser()
  if (!auth.ok) return auth.response

  if (!checkRateLimit(`verify-email:${auth.user.id}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const account = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { email: true, name: true, emailVerified: true },
  })
  if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  if (account.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true })

  const token = await createEmailVerificationToken(auth.user.id)
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const sent = await sendEmail({
    to: account.email,
    ...verifyEmailEmail(account.name, `${base}/verify-email?token=${token}`),
  })
  if (!sent) {
    return NextResponse.json({ error: 'The email could not be sent. Try again shortly.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
