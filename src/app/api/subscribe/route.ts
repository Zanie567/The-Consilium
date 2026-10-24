/**
 * POST /api/subscribe: start a double opt-in newsletter subscription.
 *
 * Every well-formed address gets the same 202 answer, whether it was new, pending, already subscribed,
 * unsubscribed or suppressed, and any email is sent after the response, so neither the body nor the timing
 * tells the requester whether an address is on the list. Nothing is ever delivered before the person clicks
 * the confirmation link. Abuse limits: per IP (here), per address and site-wide (in the database), plus a
 * honeypot field that real visitors never fill.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { normaliseEmail } from '@/lib/newsletter/identity'
import { afterResponse, readSmallJson, requestContext, sendLinkMail, NO_STORE, SUBSCRIBE_ACCEPTED_MESSAGE } from '@/lib/newsletter/http'
import { requestSubscription } from '@/lib/newsletter/subscriptions'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`subscribe:${getIp(request)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }
  const body = await readSmallJson(request)
  const identity = normaliseEmail(body?.email)
  if (!body || !identity) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400, headers: NO_STORE })
  }
  const accepted = NextResponse.json({ message: SUBSCRIBE_ACCEPTED_MESSAGE }, { status: 202, headers: NO_STORE })
  // Honeypot: a hidden field only bots fill in. Answer exactly as for a real sign-up.
  if (typeof body.website === 'string' && body.website.trim() !== '') return accepted

  try {
    const result = await requestSubscription({ email: identity, alerts: body.alerts === true }, requestContext(request))
    if (result.mail) {
      const mail = result.mail
      await afterResponse(() => sendLinkMail(mail))
    }
  } catch (error) {
    console.error('Subscribe error:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500, headers: NO_STORE })
  }
  return accepted
}
