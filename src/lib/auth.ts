import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import type { Role } from '@prisma/client'

const EDITORIAL_ROLES: Role[] = ['ADMIN', 'EDITOR', 'WRITER']

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  session: {
    strategy: 'jwt',
    // 24-hour inactivity expiry
    maxAge: 24 * 60 * 60,
    updateAge: 60 * 60, // refresh token every hour on activity
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

        if (!user || !user.password || !user.isActive) return null

        const validPassword = await bcrypt.compare(credentials.password, user.password)
        if (!validPassword) return null

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
        // Track last login time
        prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {})
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
      // Allow relative URLs
      if (url.startsWith('/')) return `${baseUrl}${url}`
      // Allow same-origin redirects
      if (url.startsWith(baseUrl)) return url
      return baseUrl
    },
  },
}

export function isEditorialUser(role: Role): boolean {
  return EDITORIAL_ROLES.includes(role)
}
