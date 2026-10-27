/**
 * POST /api/newsletter/unsubscribe: an intentional unsubscribe (a button press, never a link visit).
 *   { token }                  a preference-centre link token
 *   { email, legacyToken }     the HMAC link format used before this system (no fallback secret)
 * Records the withdrawal and a suppression so the address cannot be re-added without a fresh confirmation.
 */
import { NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { afterResponse, readSmallJson, requestContext, NO_STORE } from '@/lib/newsletter/http'
import { unsubscribeByLegacyLink, unsubscribeByToken } from '@/lib/newsletter/subscriptions'
import { getMarketingProvider } from '@/lib/newsletter/provider'
import { syncSubscriber } from '@/lib/newsletter/sync'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!checkRateLimit(`newsletter-unsubscribe:${getIp(request)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }
  const body = await readSmallJson(request)
  try {
    const ctx = requestContext(request)
    const result = body?.legacyToken !== undefined ? await unsubscribeByLegacyLink(body.email, body.legacyToken, ctx) : await unsubscribeByToken(body?.token, ctx)
    if (result.outcome === 'invalid') {
      return NextResponse.json({ status: 'invalid', error: 'This unsubscribe link is not valid or has expired.' }, { status: 400, headers: NO_STORE })
    }
    if (result.subscriberId && result.outcome === 'unsubscribed') {
      const id = result.subscriberId
      await afterResponse(async () => {
        const resolution = getMarketingProvider()
        if (resolution.provider) await syncSubscriber(resolution.provider, id).catch(() => undefined)
      })
    }
    return NextResponse.json({ status: result.outcome }, { status: 200, headers: NO_STORE })
  } catch (error) {
    console.error('[newsletter] unsubscribe failed:', (error as Error).message)
    return NextResponse.json({ error: 'We could not process this. Please try again or contact us.' }, { status: 500, headers: NO_STORE })
  }
}
