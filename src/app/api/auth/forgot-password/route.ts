import { NextResponse, NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { escapeHtml } from '@/lib/escapeHtml'
import { stripControlCharacters } from '@/lib/searchText'

// POST - request a password reset link (any user, not just editorial)
export async function POST(req: NextRequest) {
  // Rate limit to 5 requests per IP per 15 minutes
  const ip = getIp(req)
  if (!checkRateLimit(`pwd-reset-public:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ ok: true }) // silent - do not leak rate-limit info
  }

  let email: string | undefined
  try {
    ;({ email } = await req.json())
  } catch {
    return NextResponse.json({ ok: true })
  }
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: true }) // silent to prevent enumeration
  }

  // Control characters are stripped rather than passed on: a NUL survives JSON
  // decoding but Postgres cannot store one, so `?email=…%00…` failed the query
  // and returned a 500 — which is itself an enumeration signal, since every
  // other input to this endpoint answers with an identical `{ ok: true }`.
  // The catch keeps that guarantee if the lookup fails for any other reason.
  let user = null
  try {
    user = await prisma.user.findUnique({
      where: { email: stripControlCharacters(email).trim().toLowerCase() },
    })
  } catch {
    return NextResponse.json({ ok: true })
  }

  // All token + email work runs AFTER the response is sent (Next's after()), so
  // the synchronous response path is identical whether or not the account exists
  // — closing the timing side-channel — while still running reliably on
  // serverless. user.name is escaped before interpolation to avoid HTML injection.
  if (user) {
    after(async () => {
      try {
        const token = crypto.randomBytes(32).toString('hex')
        const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

        // Invalidate old tokens and create the new one atomically (both commit or
        // neither), so a partial failure can't leave the account with its existing
        // tokens revoked but no usable new token.
        await prisma.$transaction([
          prisma.passwordResetToken.updateMany({
            where: { userId: user.id, used: false },
            data: { used: true },
          }),
          prisma.passwordResetToken.create({
            data: { userId: user.id, token, expires },
          }),
        ])

        const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
        const resetUrl = `${baseUrl}/reset-password?token=${token}`

        await sendEmail({
          to: user.email!,
          subject: 'Reset your password: The Consilium',
          html: `
            <p>Hi${user.name ? ` ${escapeHtml(user.name)}` : ''},</p>
            <p>We received a request to reset your password for The Consilium.</p>
            <p><a href="${resetUrl}" style="color:#c9a227">Click here to reset your password</a></p>
            <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <p>The Consilium</p>
          `,
        })
      } catch (err) {
        // Log generically so deferred failures aren't swallowed — never the token,
        // email address, or raw payload.
        console.error(
          '[forgot-password] reset task failed:',
          err instanceof Error ? err.message : 'unknown error'
        )
      }
    })
  }

  return NextResponse.json({ ok: true })
}

// PATCH - set new password using token
export async function PATCH(req: NextRequest) {
  // This route is public and CSRF-exempt, so every input is untrusted: a
  // malformed body, a non-string token, or a NUL inside one all used to escape
  // as a 500 rather than a 400.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
  }

  const { token, password } = (body ?? {}) as { token?: unknown; password?: unknown }

  if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
    return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }
  if (password.length > 128) {
    return NextResponse.json({ error: 'Password must be at most 128 characters.' }, { status: 400 })
  }

  const expired = NextResponse.json(
    { error: 'This link has expired or already been used.' },
    { status: 400 }
  )

  let record
  try {
    record = await prisma.passwordResetToken.findUnique({
      where: { token: stripControlCharacters(token) },
    })
  } catch {
    return expired
  }
  if (!record || record.used || record.expires < new Date()) return expired

  const hashed = await bcrypt.hash(password, 10)
  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { password: hashed, failedLoginAttempts: 0, lockedUntil: null },
      }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
    ])
  } catch {
    return NextResponse.json(
      { error: 'Could not reset the password. Please try again.' },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: true })
}
