import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, passwordResetEmail } from '@/lib/email'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

// POST /api/editorial/password-reset - request reset link
// PATCH /api/editorial/password-reset - consume token and set new password

export async function POST(req: Request) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ ok: true }) // silent

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
  })

  // Always return ok to avoid user enumeration
  if (!user) return NextResponse.json({ ok: true })

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

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const { token, password } = await req.json()

  if (!token || !password) {
    return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } })
  if (!record || record.used || record.expires < new Date()) {
    return NextResponse.json({ error: 'This link has expired or already been used.' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(password, 10)
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
  ])

  return NextResponse.json({ ok: true })
}
