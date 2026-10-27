/** POST /api/newsletter/reconfirm { token }: an unsubscribed or legacy subscriber asks to subscribe again (double opt-in). */
import { NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { afterResponse, readSmallJson, requestContext, sendLinkMail, NO_STORE, SUBSCRIBE_ACCEPTED_MESSAGE } from '@/lib/newsletter/http'
import { requestReconfirmation } from '@/lib/newsletter/subscriptions'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!checkRateLimit(`newsletter-reconfirm:${getIp(request)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }
  const body = await readSmallJson(request)
  try {
    const result = await requestReconfirmation(body?.token, requestContext(request))
    if (result.outcome === 'invalid') return NextResponse.json({ status: 'invalid', error: 'This link has expired.' }, { status: 400, headers: NO_STORE })
    if (result.mail) {
      const mail = result.mail
      await afterResponse(() => sendLinkMail(mail))
    }
    return NextResponse.json({ message: SUBSCRIBE_ACCEPTED_MESSAGE }, { status: 202, headers: NO_STORE })
  } catch (error) {
    console.error('[newsletter] reconfirm failed:', (error as Error).message)
    return NextResponse.json({ error: 'Please try again.' }, { status: 500, headers: NO_STORE })
  }
}
