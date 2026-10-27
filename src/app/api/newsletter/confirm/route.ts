/**
 * POST /api/newsletter/confirm { token }: completes the double opt-in. Only ever a POST from the
 * confirmation page's button: mail scanners that prefetch the emailed link cannot confirm anyone.
 */
import { NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { afterResponse, readSmallJson, requestContext, NO_STORE } from '@/lib/newsletter/http'
import { confirmSubscription, manageUrl } from '@/lib/newsletter/subscriptions'
import { getMarketingProvider } from '@/lib/newsletter/provider'
import { syncSubscriber } from '@/lib/newsletter/sync'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, number> = { confirmed: 200, already_confirmed: 200, expired: 410, invalid: 400, suppressed: 409 }

export async function POST(request: Request) {
  if (!checkRateLimit(`newsletter-confirm:${getIp(request)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }
  const body = await readSmallJson(request)
  try {
    const result = await confirmSubscription(body?.token, requestContext(request))
    if (result.outcome === 'confirmed' && result.subscriberId) {
      const id = result.subscriberId
      // Best effort: a failure leaves the row PENDING and the newsletter tick retries it.
      await afterResponse(async () => {
        const resolution = getMarketingProvider()
        if (resolution.provider) await syncSubscriber(resolution.provider, id).catch(() => undefined)
      })
    }
    return NextResponse.json(
      { status: result.outcome, ...(result.manageToken ? { manageUrl: manageUrl(result.manageToken) } : {}) },
      { status: STATUS[result.outcome] ?? 400, headers: NO_STORE },
    )
  } catch (error) {
    console.error('[newsletter] confirm failed:', (error as Error).message)
    return NextResponse.json({ error: 'We could not confirm your subscription. Please try again.' }, { status: 500, headers: NO_STORE })
  }
}
