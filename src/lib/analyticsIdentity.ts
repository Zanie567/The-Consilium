import { getCookieConsent } from '@/components/ui/CookieConsent'
const KEY = 'consilium_analytics_reader'
let session: string | undefined
export function analyticsIdentity(): { sessionId: string; readerId?: string; consent: boolean } {
  session ??= crypto.randomUUID()
  const consent = getCookieConsent() === 'accepted'
  try {
    localStorage.removeItem('consilium_sid')
    if (!consent) {
      localStorage.removeItem(KEY)
      return { sessionId: session, consent: false }
    }
    const raw = localStorage.getItem(KEY)
    const existing = raw ? JSON.parse(raw) : null
    const valid =
      existing &&
      typeof existing.id === 'string' &&
      /^[a-f0-9-]{36}$/.test(existing.id) &&
      Number.isFinite(existing.expires) &&
      existing.expires > Date.now() &&
      existing.expires <= Date.now() + 90 * 86400000
    const reader = valid
      ? existing
      : { id: crypto.randomUUID(), expires: Date.now() + 90 * 86400000 }
    if (!valid) localStorage.setItem(KEY, JSON.stringify(reader))
    return { sessionId: session, readerId: reader.id, consent: true }
  } catch {
    return { sessionId: session, consent: false }
  }
}
