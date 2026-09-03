import { NextResponse } from 'next/server'
import { NextAuthOptions } from 'next-auth'
import { getServerSession } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { sendEmail } from './email'
import { escapeHtml } from './escapeHtml'
import type { Role, PrismaClient } from '@prisma/client'

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error(
    'NEXTAUTH_SECRET is not set. Add it to your .env.local file or Vercel environment variables.'
  )
}

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000

async function logAttempt(email: string, ipAddress: string, success: boolean) {
  try {
    await prisma.loginAttempt.create({ data: { email, ipAddress, success } })
  } catch {
    // Never let logging failures break auth
  }
}

async function notifyAdminOfLockout(lockedEmail: string, ip: string) {
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { email: true },
    })
    if (!admin?.email) return
    await sendEmail({
      to: admin.email,
      subject: 'Account locked: too many failed login attempts',
      html: `
        <p>The account <strong>${escapeHtml(lockedEmail)}</strong> has been temporarily locked after ${MAX_FAILED_ATTEMPTS} consecutive failed login attempts.</p>
        <p><strong>IP address:</strong> <code>${escapeHtml(ip)}</code></p>
        <p>The account will unlock automatically after 15 minutes.</p>
        <p>If this was not a legitimate user, consider reviewing recent login attempts in the admin dashboard.</p>
        <p>The Consilium</p>
      `,
    })
  } catch {
    // Don't fail auth if notification fails
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  // The client carries a global `omit` for User.password, which changes its
  // static type; the adapter only ever touches OAuth columns (never password),
  // so the cast is safe at runtime.
  adapter: PrismaAdapter(prisma as unknown as PrismaClient) as NextAuthOptions['adapter'],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60,
    updateAge: 60 * 60,
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    ...(googleClientId && googleClientSecret
      ? [
          GoogleProvider({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            // Force account selection on every sign-in so users with multiple
            // Google accounts are not silently signed into the wrong one.
            authorization: {
              params: { prompt: 'select_account' },
            },
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null

        const ip =
          (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0].trim() ??
          (req?.headers?.['x-real-ip'] as string) ??
          'unknown'

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          // Override the global omit: the password hash is required here to
          // verify the supplied credentials with bcrypt.compare below.
          omit: { password: false },
        })

        if (user?.isBanned) {
          await logAttempt(credentials.email, ip, false)
          return null
        }

        if (user?.lockedUntil && user.lockedUntil > new Date()) {
          await logAttempt(credentials.email, ip, false)
          return null
        }

        if (!user || !user.password || !user.isActive) {
          await logAttempt(credentials.email, ip, false)
          return null
        }

        const validPassword = await bcrypt.compare(credentials.password, user.password)

        if (!validPassword) {
          const { failedLoginAttempts: newCount } = await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: { increment: 1 } },
            select: { failedLoginAttempts: true },
          })

          if (newCount >= MAX_FAILED_ATTEMPTS) {
            await prisma.user.update({
              where: { id: user.id },
              data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
            })
            notifyAdminOfLockout(user.email, ip).catch(() => {})
          }

          await logAttempt(credentials.email, ip, false)
          return null
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastActiveAt: new Date(),
          },
        })

        await logAttempt(credentials.email, ip, true)

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Only gate OAuth sign-ins here. The credentials provider handles its
      // own checks inside authorize above.
      if (account?.provider === 'google') {
        if (!user.email) return false

        // Only trust Google's email for account lookup + auto-linking if Google
        // says it is verified. Without this, a Google sign-in with an unverified
        // address matching an existing password account would auto-link to it.
        const googleProfile = profile as { email_verified?: boolean } | undefined
        if (!googleProfile?.email_verified) return false

        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, isBanned: true, isActive: true },
        })

        // No existing record: PrismaAdapter creates a new user with the
        // default READER role. Allow it through.
        if (!dbUser) return true

        // Block suspended or deactivated accounts from using Google sign-in
        // as a bypass route around the credentials checks.
        if (dbUser.isBanned || !dbUser.isActive) return false

        // If the user registered with email/password and is signing in with
        // Google for the first time, link the Google account automatically
        // rather than throwing OAuthAccountNotLinked.
        const linked = await prisma.account.findFirst({
          where: { userId: dbUser.id, provider: 'google' },
        })
        if (!linked) {
          await prisma.account.create({
            data: {
              userId: dbUser.id,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              access_token: account.access_token ?? null,
              refresh_token: account.refresh_token ?? null,
              expires_at: account.expires_at ?? null,
              token_type: account.token_type ?? null,
              scope: account.scope ?? null,
              id_token: account.id_token ?? null,
              session_state: account.session_state ? String(account.session_state) : null,
            },
          })
        }

        // Mirror the credentials flow: update login timestamps on success.
        await prisma.user
          .update({
            where: { id: dbUser.id },
            data: { lastLoginAt: new Date(), lastActiveAt: new Date() },
          })
          .catch(() => {})

        return true
      }

      return true
    },

    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.id = user.id
        token.roleCheckedAt = Date.now()
        token.isBanned = false
        token.bannedCheckedAt = Date.now()
        token.isActive = true
        token.activeCheckedAt = Date.now()
      } else {
        const oneMinuteAgo = Date.now() - 60 * 1000

        const needsBanCheck = !token.bannedCheckedAt || token.bannedCheckedAt < oneMinuteAgo
        const needsRoleCheck = !token.roleCheckedAt || token.roleCheckedAt < oneMinuteAgo
        const needsActiveCheck = !token.activeCheckedAt || token.activeCheckedAt < oneMinuteAgo

        if (needsBanCheck || needsRoleCheck || needsActiveCheck) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: token.id },
              select: { role: true, isActive: true, isBanned: true },
            })
            if (dbUser) {
              token.isActive = dbUser.isActive
              token.activeCheckedAt = Date.now()
              if (needsBanCheck) {
                token.isBanned = dbUser.isBanned
                token.bannedCheckedAt = Date.now()
              }
              if (needsRoleCheck) {
                token.role = (!dbUser.isActive || dbUser.isBanned) ? 'READER' : dbUser.role
                token.roleCheckedAt = Date.now()
              }
            } else {
              token.isActive = false
              token.activeCheckedAt = Date.now()
              token.isBanned = true
              token.bannedCheckedAt = Date.now()
              token.role = 'READER'
              token.roleCheckedAt = Date.now()
            }
          } catch {
            // DB unavailable - use cached token values
          }
        }
      }
      return token
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.role = token.role
        session.user.id = token.id
        session.user.isBanned = token.isBanned ?? false
        session.user.isActive = token.isActive ?? true
      }
      return session
    },

    async redirect({ url, baseUrl }) {
      // Compare parsed ORIGINS, never string prefixes. `url` is the raw
      // callbackUrl parameter or cookie, which NextAuth hands to this callback
      // without validating it first (core/lib/callback-url.js), so this is the
      // only gate on the OAuth sign-in path. `url.startsWith(baseUrl)` accepts
      // any host that merely begins with the base URL —
      // `https://<base-host>.evil.example` and `https://<base-host>@evil.example`
      // both pass a prefix test and both send the user to evil.example.
      //
      // Resolving against baseUrl keeps relative callbacks (`/editorial`)
      // working while normalising host case and the default port, and rejects
      // protocol-relative `//evil.example` outright.
      try {
        const target = new URL(url, baseUrl)
        if (target.origin === new URL(baseUrl).origin) return target.toString()
      } catch {
        // Unparseable callback URL: fall through to baseUrl.
      }
      return baseUrl
    },
  },
}

export async function getVerifiedSessionUser(
  allowedRoles?: readonly Role[]
): Promise<{ id: string; role: Role; name: string | null; email: string | null } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, name: true, email: true, isActive: true, isBanned: true },
  })

  if (!user || !user.isActive || user.isBanned) return null
  if (allowedRoles && !allowedRoles.includes(user.role)) return null

  return { id: user.id, role: user.role, name: user.name, email: user.email }
}

export function requireActiveSession(
  session: { user?: { isBanned?: boolean; isActive?: boolean } | null } | null
): Response | null {
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.isActive === false) {
    return NextResponse.json({ error: 'Your account is inactive.' }, { status: 403 })
  }
  if (session.user.isBanned) {
    return NextResponse.json({ error: 'Your account has been suspended.' }, { status: 403 })
  }
  return null
}
