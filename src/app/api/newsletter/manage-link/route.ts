/** POST /api/newsletter/manage-link { email }: emails a preference link. Same answer for every address. */
import { NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { afterResponse, readSmallJson, requestContext, sendLinkMail, MANAGE_LINK_ACCEPTED_MESSAGE, NO_STORE } from '@/lib/newsletter/http'
import { normaliseEmail } from '@/lib/newsletter/identity'
import { requestManageLink } from '@/lib/newsletter/subscriptions'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!checkRateLimit(`newsletter-manage:${getIp(request)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }
  const body = await readSmallJson(request)
  if (!normaliseEmail(body?.email)) return NextResponse.json({ error: 'Valid email required' }, { status: 400, headers: NO_STORE })
  try {
    const result = await requestManageLink(body?.email, requestContext(request))
    if (result.mail) {
      const mail = result.mail
      await afterResponse(() => sendLinkMail(mail))
    }
  } catch (error) {
    console.error('[newsletter] manage link failed:', (error as Error).message)
  }
  return NextResponse.json({ message: MANAGE_LINK_ACCEPTED_MESSAGE }, { status: 202, headers: NO_STORE })
}
