import { NextResponse, after } from 'next/server'
import { sendEmail } from '@/lib/email'
import { getIp } from '@/lib/rate-limit'
import { CampaignError } from './campaigns'
import { isTestEnvironment } from './config'
import type { LinkMail, RequestContext } from './subscriptions'

/** Small JSON bodies only; anything else is treated as an empty object. */
export async function readSmallJson(request: Request, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => '')
  if (!text || text.length > maxBytes) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function requestContext(request: Request): RequestContext {
  return { ip: getIp(request), userAgent: request.headers.get('user-agent') }
}

/**
 * Runs `task` after the response is sent (so response time does not reveal whether a mail was sent),
 * or straight away when there is no request scope (tests, scripts).
 */
export async function afterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task)
    return
  } catch {
    // Not inside a request.
  }
  await task()
}

/** Confirmation and preference links: the transactional sender, never the marketing provider. */
export async function sendLinkMail(mail: LinkMail): Promise<void> {
  // Belt and braces: a test process only ever captures. Without a capture transport the mail is dropped,
  // so a production RESEND_API_KEY lingering in a shell can never send from a test run.
  if (isTestEnvironment() && process.env.EMAIL_TRANSPORT !== 'capture' && process.env.EMAIL_TRANSPORT !== 'capture-db') {
    console.warn('[newsletter] test environment without captured email: link mail dropped')
    return
  }
  const sent = await sendEmail(mail).catch((error) => {
    console.error('[newsletter] link mail failed:', (error as Error).message)
    return false
  })
  if (!sent) console.warn('[newsletter] link mail was not handed to the transport')
}

export function campaignErrorResponse(error: unknown): NextResponse {
  if (error instanceof CampaignError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  console.error('[newsletter] editorial action failed:', error)
  return NextResponse.json({ error: 'Something went wrong. Nothing was sent.', code: 'SERVER_ERROR' }, { status: 500 })
}

export const NO_STORE = { 'Cache-Control': 'no-store' }

export const SUBSCRIBE_ACCEPTED_MESSAGE =
  'Thank you. If this address can receive The Consilium, a confirmation link is on its way. Please check your inbox (and spam folder) to finish subscribing.'

export const MANAGE_LINK_ACCEPTED_MESSAGE =
  'If this address is subscribed to The Consilium, we have emailed it a link to manage your preferences.'
