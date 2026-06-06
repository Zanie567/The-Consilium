import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, passwordResetEmail } from '@/lib/email'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

// POST /api/editorial/password-reset - request reset link
// PATCH /api/editorial/password-reset - consume token and set new password

export async function POST(req: NextRequest) {
  // Rate limit to 5 requests per IP per 15 minutes
  const ip = getIp(req)
  if (!checkRateLimit(`pwd-reset-editorial:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ ok: true }) // silent - do not leak rate-limit info
  }

  let email: string | undefined
  try {
    ;({ email } = await req.json())
  } catch {
    // Malformed body is a client error - return 400 instead of silently succeeding
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  if (!email) return NextResponse.json({ ok: true }) // silent

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), role: { in: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'] } },
  })

  // Always return ok to avoid user enumeration. All token + email work runs AFTER
  // the response (Next's after()) so the synchronous response path is identical
  // whether or not the account exists — closing the timing side-channel — while
  // still running reliably on serverless.
  if (user) {
    after(async () => {
      try {
        // Invalidate old tokens
        await prisma.passwordResetToken.updateMany({
          where: { userId: user.id, used: false },
          data: { used: true },
        })

        const token = crypto.randomBytes(32).toString('hex')
        const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

        await prisma.passwordResetToken.create({
          data: { userId: user.id, token, expires },
        })

        const resetUrl = `${process.env.NEXTAUTH_URL}/editorial/reset-password?token=${token}`
        const { subject, html } = passwordResetEmail(resetUrl)
        await sendEmail({ to: user.email!, subject, html })
      } catch {
        // Never surface reset internals to the caller.
      }
    })
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  let token: string | undefined, password: string | undefined
  try {
    ;({ token, password } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
  }

  if (!token || !password) {
    return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const TOKEN_LENGTH = 64 // 32 random bytes → 64 hex chars

  // Fetch the record from the DB, then re-verify the token in
  // constant time so the application layer reveals nothing via timing.
  // The dummy value keeps the timingSafeEqual call on the hot path even
  // when no matching record exists, preventing short-circuit timing leaks.
  const record = await prisma.passwordResetToken.findUnique({ where: { token } })
  const storedToken = record?.token ?? '0'.repeat(TOKEN_LENGTH)
  const tokensMatch = crypto.timingSafeEqual(
    Buffer.from(token.padEnd(TOKEN_LENGTH, '\0').slice(0, TOKEN_LENGTH)),
    Buffer.from(storedToken.padEnd(TOKEN_LENGTH, '\0').slice(0, TOKEN_LENGTH))
  )

  if (!tokensMatch || !record || record.used || record.expires < new Date()) {
    return NextResponse.json({ error: 'This link has expired or already been used.' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(password, 10)
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
  ])

  return NextResponse.json({ ok: true })
}
