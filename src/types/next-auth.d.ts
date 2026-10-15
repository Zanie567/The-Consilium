import { Role } from '@prisma/client'
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    testing?: { id: string; administratorId: string; persona: 'writer' | 'writer-other' | 'editor' | 'editor-global' | 'growth'; expiresAt: string }
    requestIdentity?: string
    testingIdentityChanged?: boolean
    /** Epoch ms after which the client renews the session cookie (see SESSION_RENEW_AFTER_S). */
    renewAt?: number
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role: Role
      isBanned?: boolean
      isActive?: boolean
    }
  }

  interface User {
    role: Role
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: Role
    id: string
    isBanned?: boolean
    isActive?: boolean
    bannedCheckedAt?: number
    roleCheckedAt?: number
    activeCheckedAt?: number
    /** credentialStamp() of the password hash at sign-in; a mismatch signs the session out. */
    credential?: string
  }
}
