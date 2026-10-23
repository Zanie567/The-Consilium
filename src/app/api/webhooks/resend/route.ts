/**
 * POST /api/webhooks/resend: Resend (Svix-signed) webhook receiver.
 *
 * 401 unless the signature verifies with RESEND_WEBHOOK_SECRET (or _PREVIOUS during rotation). Each delivery
 * is stored once by svix-id (a redelivery is a no-op) and processed; a processing failure answers 500 so
 * Resend retries, and the newsletter tick re-processes failed events as well.
 */
import { NextResponse } from 'next/server'
import { processWebhookEvent, storeWebhookEvent, verifyWebhookSignature, webhookSecrets } from '@/lib/newsletter/webhooks'

export const dynamic = 'force-dynamic'

const MAX_BODY = 256 * 1024

export async function POST(request: Request) {
  const payload = await request.text().catch(() => '')
  if (!payload || payload.length > MAX_BODY) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const verified = verifyWebhookSignature(payload, request.headers, webhookSecrets())
  if (!verified.ok) {
    if (verified.reason === 'webhook secret not configured') console.error('[newsletter] RESEND_WEBHOOK_SECRET is not set; webhook refused')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let event: { type?: unknown; created_at?: unknown; data?: Record<string, unknown> }
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  try {
    const stored = await storeWebhookEvent(verified.id, event)
    const outcome = await processWebhookEvent(verified.id)
    if (outcome === 'FAILED') return NextResponse.json({ received: true, processed: false }, { status: 500 })
    return NextResponse.json({ received: true, duplicate: stored === 'duplicate' })
  } catch (error) {
    console.error('[newsletter] webhook handling failed:', (error as Error).message)
    return NextResponse.json({ received: false }, { status: 500 })
  }
}
