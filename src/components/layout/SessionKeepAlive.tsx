'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from 'next-auth/react'

/**
 * Keeps a returning reader signed in. NextAuth re-issues the session cookie (a fresh 60-day expiry) only when
 * /api/auth/session is called, and SessionProvider never calls it on load because the layout already supplies the
 * session. So once the cookie is a day old (`renewAt`, set by the session callback in lib/auth.ts) this asks for it
 * once. The cookie stays HttpOnly and is written by NextAuth itself; nothing is stored in the browser by this code.
 * If the server no longer accepts the session (for example the password was reset elsewhere), the page refreshes
 * so it stops showing a signed-in state.
 */
export function SessionKeepAlive({ renewAt }: { renewAt?: number }) {
  const router = useRouter()
  useEffect(() => {
    if (!renewAt || Date.now() < renewAt) return
    let cancelled = false
    getSession()
      .then((current) => { if (!cancelled && !current) router.refresh() })
      .catch(() => {}) // offline or a transient error: the next visit tries again
    return () => { cancelled = true }
  }, [renewAt, router])
  return null
}
