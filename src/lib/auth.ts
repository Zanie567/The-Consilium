import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { sendEmail } from './email'
import type { Role } from '@prisma/client'

const EDITORIAL_ROLES: Role[] = ['ADMIN', 'EDITOR', 'WRITER']
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

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
        <p>The account <strong>${lockedEmail}</strong> has been temporarily locked after ${MAX_FAILED_ATTEMPTS} consecutive failed login attempts.</p>
        <p><strong>IP address:</strong> <code>${ip}</code></p>
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
  adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60,
    updateAge: 60 * 60,
  },
  pages: {
    signIn: '/login',
  },
  providers: [
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
        })

        // Account locked
        if (user?.lockedUntil && user.lockedUntil > new Date()) {
          await logAttempt(credentials.email, ip, false)
          return null
        }

        // Unknown user, inactive, or no password
        if (!user || !user.password || !user.isActive) {
          await logAttempt(credentials.email, ip, false)
          return null
        }

        const validPassword = await bcrypt.compare(credentials.password, user.password)

        if (!validPassword) {
          const newCount = user.failedLoginAttempts + 1
          const shouldLock = newCount >= MAX_FAILED_ATTEMPTS

          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: newCount,
              ...(shouldLock && { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }),
            },
          })

          await logAttempt(credentials.email, ip, false)

          if (shouldLock) {
            notifyAdminOfLockout(user.email, ip).catch(() => {})
          }

          return null
        }

        // Successful login - reset lockout state
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
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
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as unknown as { role: Role }).role
        token.id = user.id
        token.roleCheckedAt = Date.now()
      } else {
        // Re-fetch role from DB every 30 minutes so role changes take effect without re-login
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
        if (!token.roleCheckedAt || (token.roleCheckedAt as number) < thirtyMinutesAgo) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: { role: true, isActive: true },
            })
            if (dbUser) {
              token.role = dbUser.role
              token.roleCheckedAt = Date.now()
              // If account deactivated, mark so session callback can reject
              if (!dbUser.isActive) token.isActive = false
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
        ;(session.user as unknown as { role: Role; id: string }).role = token.role as Role
        ;(session.user as unknown as { id: string }).id = token.id as string
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`
      if (url.startsWith(baseUrl)) return url
      return baseUrl
    },
  },
}

export function isEditorialUser(role: Role): boolean {
  return EDITORIAL_ROLES.includes(role)
}
