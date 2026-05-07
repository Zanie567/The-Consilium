import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

// POST - request a password reset link (any user, not just editorial)
export async function POST(req: NextRequest) {
  // BUG-21: rate limit to 5 requests per IP per 15 minutes
  const ip = getIp(req)
  if (!checkRateLimit(`pwd-reset-public:${ip}`, 5, 15 * 60 * 1000)) {
    return Response.json({ ok: true }) // silent - do not leak rate-limit info
  }

  let email: string | undefined
  try {
    ;({ email } = await req.json())
  } catch {
    return Response.json({ ok: true })
  }
  if (!email || typeof email !== 'string') {
    return Response.json({ ok: true }) // silent to prevent enumeration
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  })

  if (!user) return Response.json({ ok: true })

  // Invalidate existing tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, used: false },
    data: { used: true },
  })

  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expires },
  })

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const resetUrl = `${baseUrl}/reset-password?token=${token}`

  await sendEmail({
    to: user.email!,
    subject: 'Reset your password: The Consilium',
    html: `
      <p>Hi${user.name ? ` ${user.name}` : ''},</p>
      <p>We received a request to reset your password for The Consilium.</p>
      <p><a href="${resetUrl}" style="color:#c9a227">Click here to reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      <p>The Consilium</p>
    `,
  })

  return Response.json({ ok: true })
}

// PATCH - set new password using token
export async function PATCH(req: NextRequest) {
  const { token, password } = await req.json()

  if (!token || !password) {
    return Response.json({ error: 'Missing fields.' }, { status: 400 })
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } })
  if (!record || record.used || record.expires < new Date()) {
    return Response.json({ error: 'This link has expired or already been used.' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(password, 10)
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { password: hashed, failedLoginAttempts: 0, lockedUntil: null } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
  ])

  return Response.json({ ok: true })
}
