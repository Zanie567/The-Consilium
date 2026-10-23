/** POST /api/newsletter/preferences { token, weeklyDigest, specialAlerts }: preference centre changes. */
import { NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { afterResponse, readSmallJson, requestContext, NO_STORE } from '@/lib/newsletter/http'
import { updatePreferences } from '@/lib/newsletter/subscriptions'
import { getMarketingProvider } from '@/lib/newsletter/provider'
import { syncSubscriber } from '@/lib/newsletter/sync'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!checkRateLimit(`newsletter-preferences:${getIp(request)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }
  const body = await readSmallJson(request)
  if (!body || typeof body.weeklyDigest !== 'boolean' || typeof body.specialAlerts !== 'boolean') {
    return NextResponse.json({ error: 'Choose your preferences.' }, { status: 400, headers: NO_STORE })
  }
  try {
    const result = await updatePreferences(body.token, { weeklyDigest: body.weeklyDigest, specialAlerts: body.specialAlerts }, requestContext(request))
    if (result.outcome === 'invalid') {
      return NextResponse.json({ status: 'invalid', error: 'This link has expired. Request a new one below.' }, { status: 400, headers: NO_STORE })
    }
    if (result.subscriberId && (result.outcome === 'updated' || result.outcome === 'unsubscribed')) {
      const id = result.subscriberId
      await afterResponse(async () => {
        const resolution = getMarketingProvider()
        if (resolution.provider) await syncSubscriber(resolution.provider, id).catch(() => undefined)
      })
    }
    return NextResponse.json({ status: result.outcome }, { status: result.outcome === 'not_active' ? 409 : 200, headers: NO_STORE })
  } catch (error) {
    console.error('[newsletter] preferences failed:', (error as Error).message)
    return NextResponse.json({ error: 'Your preferences were not saved. Please try again.' }, { status: 500, headers: NO_STORE })
  }
}
