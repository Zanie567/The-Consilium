'use client'
import { SessionProvider } from 'next-auth/react'
import { useEffect } from 'react'
import type { Session } from 'next-auth'
import { getTestingTabId, identityPinnedFetch, isTestingTransition, setTestingTransition } from '@/lib/testingClient'
import { TestingControls } from './TestingControls'

export function AuthProvider({ children, session, testWorkspace = false }: { children: React.ReactNode; session?: Session | null; testWorkspace?: boolean }) {
  useEffect(() => {
    if (!testWorkspace) return
    const original = window.fetch.bind(window)
    const identity = session?.requestIdentity
    window.fetch = identityPinnedFetch(original, identity, location.origin)
    // Browser history may restore a document with an old identity from bfcache.
    const verifyIdentity = async () => {
      // Anonymous sign-up/login pages have no rendered actor to invalidate.
      // Their normal auth flow chooses the destination after creating a session.
      if (isTestingTransition() || !identity) return
      const response = await original('/api/auth/session', { cache: 'no-store' })
      if (!response.ok) return
      const current = await response.json()
      if (!isTestingTransition() && current.requestIdentity !== identity) window.location.replace('/editorial')
    }
    const checkIdentity = () => { void verifyIdentity().catch(() => {}) }
    const restoreIdentity = () => { setTestingTransition(false); checkIdentity() }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) restoreIdentity() }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('popstate', restoreIdentity)
    window.addEventListener('focus', checkIdentity)
    const tabId = getTestingTabId()
    const channel = new BroadcastChannel('consilium-testing')
    channel.onmessage = (event) => { if (event.data?.source !== tabId) window.location.assign('/editorial') }
    return () => { window.fetch = original; channel.close(); window.removeEventListener('pageshow', onPageShow); window.removeEventListener('popstate', restoreIdentity); window.removeEventListener('focus', checkIdentity) }
  }, [session?.requestIdentity, testWorkspace])
  return <SessionProvider session={session}>
    {testWorkspace && <TestingControls banner testing={session?.testing} ordinaryRole={session?.user.role} />}
    {children}
  </SessionProvider>
}
