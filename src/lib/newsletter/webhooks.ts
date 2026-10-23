/**
 * Resend webhooks (delivered through Svix): verification, idempotent storage and processing.
 *
 * Verification follows the Svix scheme: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw body}` with the
 * base64 secret after `whsec_`, compared in constant time against every `v1,` signature in the header,
 * timestamp within 5 minutes. RESEND_WEBHOOK_SECRET_PREVIOUS is also accepted during a rotation.
 *
 * Processing rules:
 *   - contact.updated with unsubscribed = true          -> UNSUBSCRIBED (+ suppression, consent event)
 *   - contact.updated with unsubscribed = false while we have the contact withdrawn -> NOT re-subscribed;
 *     our state is pushed back to Resend (re-subscription only through double opt-in)
 *   - contact.updated topic changes (fetched from Resend) -> withdrawals applied, opt-ins applied only for an
 *     ACTIVE subscriber (recorded as consent from Resend's preference page)
 *   - contact.deleted                                   -> UNSUBSCRIBED (fail safe: no mail to a contact
 *                                                          someone removed in Resend)
 *   - email.bounced (Permanent) / email.complained / email.suppressed -> SUPPRESSED (+ suppression)
 *   - email.delivered / bounced / complained with broadcast_id -> campaign delivery counters
 *   - everything else                                   -> IGNORED (opens and clicks are not stored)
 * Out-of-order contact events are ignored using the provider's updated_at.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Prisma, Subscriber } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { WEBHOOK_EVENT_RETENTION_DAYS } from './config'
import { recordConsentEvent, upsertSuppression, type SuppressionReason } from './consent'
import { normaliseEmail } from './identity'
import { getMarketingProvider } from './provider'
import { subscriberIdentity, unsubscribeInTx } from './subscriptions'

const TOLERANCE_SECONDS = 5 * 60
const MAX_EVENT_ATTEMPTS = 10

export type VerifyResult = { ok: true; id: string } | { ok: false; reason: string }

function secretKey(secret: string): Buffer | null {
  const value = secret.trim().replace(/^whsec_/, '')
  if (!value) return null
  const key = Buffer.from(value, 'base64')
  return key.length >= 16 ? key : null
}

export function verifyWebhookSignature(
  payload: string,
  headers: { get(name: string): string | null },
  secrets: (string | undefined)[],
  now = Date.now(),
): VerifyResult {
  const id = headers.get('svix-id') ?? ''
  const timestamp = headers.get('svix-timestamp') ?? ''
  const signatureHeader = headers.get('svix-signature') ?? ''
  if (!id || id.length > 200 || !/^\d{1,12}$/.test(timestamp) || !signatureHeader) return { ok: false, reason: 'missing signature headers' }
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside tolerance' }
  const keys = secrets.map((s) => (s ? secretKey(s) : null)).filter((k): k is Buffer => k !== null)
  if (keys.length === 0) return { ok: false, reason: 'webhook secret not configured' }
  const signatures = signatureHeader
    .split(' ')
    .map((part) => part.split(','))
    .filter(([version, value]) => version === 'v1' && Boolean(value))
    .map(([, value]) => Buffer.from(value, 'base64'))
  let matched = false
  for (const key of keys) {
    const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest()
    for (const signature of signatures) {
      if (signature.length === expected.length && timingSafeEqual(signature, expected)) matched = true
    }
  }
  return matched ? { ok: true, id } : { ok: false, reason: 'signature mismatch' }
}

export function webhookSecrets(): (string | undefined)[] {
  return [process.env.RESEND_WEBHOOK_SECRET, process.env.RESEND_WEBHOOK_SECRET_PREVIOUS]
}

interface WebhookPayload {
  type?: unknown
  created_at?: unknown
  data?: Record<string, unknown>
}

/** Only what processing needs; recipient addresses are kept for 30 days at most (pruned by the tick). */
function minimisePayload(payload: WebhookPayload): Prisma.InputJsonValue {
  const data = payload.data ?? {}
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))
  return {
    type: String(payload.type ?? ''),
    created_at: typeof payload.created_at === 'string' ? payload.created_at : null,
    data: pick(['id', 'email', 'unsubscribed', 'updated_at', 'created_at', 'to', 'broadcast_id', 'email_id', 'bounce', 'suppressed', 'segment_ids']),
  } as Prisma.InputJsonValue
}

export type StoreResult = 'stored' | 'duplicate'

/** Idempotent: the svix-id is the primary key; a redelivery of a processed event is a no-op. */
export async function storeWebhookEvent(id: string, payload: WebhookPayload): Promise<StoreResult> {
  const result = await prisma.newsletterWebhookEvent.createMany({
    data: [{ id, type: String(payload.type ?? 'unknown').slice(0, 64), payload: minimisePayload(payload) }],
    skipDuplicates: true,
  })
  return result.count === 1 ? 'stored' : 'duplicate'
}

async function findSubscriber(tx: Prisma.TransactionClient, ref: { contactId?: unknown; email?: unknown }): Promise<Subscriber | null> {
  if (typeof ref.contactId === 'string' && ref.contactId) {
    const byContact = await tx.subscriber.findUnique({ where: { resendContactId: ref.contactId } })
    if (byContact) return byContact
  }
  const identity = normaliseEmail(ref.email)
  if (!identity) return null
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscribers WHERE public.consilium_subscriber_identity(email) = ${identity} LIMIT 1`
  return rows.length ? tx.subscriber.findUnique({ where: { id: rows[0].id } }) : null
}

async function suppress(tx: Prisma.TransactionClient, sub: Subscriber | null, identity: string, reason: SuppressionReason, eventId: string) {
  await upsertSuppression(tx, identity, reason, 'resend_webhook')
  if (!sub || sub.status === 'SUPPRESSED') return
  await tx.subscriber.update({
    where: { id: sub.id },
    data: { status: 'SUPPRESSED', suppressedAt: new Date(), suppressionReason: reason, resendSyncState: 'PENDING', resendSyncAttempts: 0, resendSyncError: null },
  })
  await tx.subscriberToken.updateMany({ where: { subscriberId: sub.id, usedAt: null, purpose: 'CONFIRM' }, data: { expiresAt: new Date() } })
  await recordConsentEvent(tx, { subscriberId: sub.id, identity, action: 'SUPPRESSED', source: 'resend_webhook', actor: 'resend', detail: { reason, eventId, previousStatus: sub.status } })
}

async function bumpCampaign(broadcastId: unknown, field: 'deliveredCount' | 'bouncedCount' | 'complainedCount') {
  if (typeof broadcastId !== 'string' || !broadcastId) return
  await prisma.newsletterCampaign.updateMany({ where: { resendBroadcastId: broadcastId }, data: { [field]: { increment: 1 } } })
}

type Outcome = 'PROCESSED' | 'IGNORED'

async function processContactEvent(eventId: string, type: string, data: Record<string, unknown>): Promise<Outcome> {
  const providerUpdatedAt = typeof data.updated_at === 'string' ? new Date(data.updated_at) : null
  const subscriberId = await prisma.$transaction(async (tx) => {
    const sub = await findSubscriber(tx, { contactId: data.id, email: data.email })
    if (!sub) return null
    const identity = subscriberIdentity(sub)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscriber:${identity}`}))`
    const current = await tx.subscriber.findUniqueOrThrow({ where: { id: sub.id } })
    // Strictly older than a change already applied: skip. Equal is allowed so a retried event (whose first
    // attempt stamped this time before failing) is re-run; every step below is idempotent.
    if (providerUpdatedAt && !Number.isNaN(providerUpdatedAt.getTime()) && current.resendUpdatedAt && providerUpdatedAt < current.resendUpdatedAt) {
      return null
    }
    const stamp = providerUpdatedAt && !Number.isNaN(providerUpdatedAt.getTime()) ? { resendUpdatedAt: providerUpdatedAt } : {}
    if (typeof data.id === 'string' && !current.resendContactId && type !== 'contact.deleted') {
      await tx.subscriber.update({ where: { id: current.id }, data: { resendContactId: data.id } }).catch(() => undefined)
    }
    if (type === 'contact.deleted' || data.unsubscribed === true) {
      await unsubscribeInTx(tx, current, 'resend_webhook', {}, new Date(), 'resend')
      if (type === 'contact.deleted') await tx.subscriber.update({ where: { id: current.id }, data: { resendContactId: null, resendSyncState: 'SYNCED', ...stamp } })
      else await tx.subscriber.update({ where: { id: current.id }, data: stamp })
      return null
    }
    if (current.status !== 'ACTIVE') {
      // Resend says "subscribed" but we have no current consent: push our state back, never re-subscribe.
      if (data.unsubscribed === false) {
        await tx.subscriber.update({ where: { id: current.id }, data: { resendSyncState: 'PENDING', ...stamp } })
        await recordConsentEvent(tx, { subscriberId: current.id, identity, action: 'RESUBSCRIBE_REFUSED', source: 'resend_webhook', actor: 'resend', detail: { eventId, status: current.status } })
      }
      return null
    }
    await tx.subscriber.update({ where: { id: current.id }, data: stamp })
    return current.id // ACTIVE and still subscribed in Resend: topics may have changed there
  })
  if (!subscriberId) return 'PROCESSED'

  // Topic changes made on Resend's preference page are not in the event; ask Resend.
  const resolution = getMarketingProvider()
  if (!resolution.provider) throw new Error('marketing provider unavailable; topic sync deferred')
  const sub = await prisma.subscriber.findUniqueOrThrow({ where: { id: subscriberId } })
  const topics = await resolution.provider.getContactTopics({ contactId: sub.resendContactId, email: subscriberIdentity(sub) })
  if (topics.weekly === null || topics.alerts === null) return 'PROCESSED'
  if (topics.weekly === sub.weeklyDigest && topics.alerts === sub.specialAlerts) {
    await prisma.subscriber.updateMany({ where: { id: sub.id, resendSyncState: 'SYNCED' }, data: { resendVerifiedAt: new Date() } })
    return 'PROCESSED'
  }
  await prisma.$transaction(async (tx) => {
    const identity = subscriberIdentity(sub)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscriber:${identity}`}))`
    const current = await tx.subscriber.findUniqueOrThrow({ where: { id: sub.id } })
    if (current.status !== 'ACTIVE') return
    if (!topics.weekly && !topics.alerts) {
      await unsubscribeInTx(tx, current, 'resend_webhook', {}, new Date(), 'resend')
      return
    }
    await tx.subscriber.update({
      where: { id: current.id },
      // Resend already reflects this; mark synced so we do not echo it back.
      data: { weeklyDigest: topics.weekly as boolean, specialAlerts: topics.alerts as boolean, preferencesUpdatedAt: new Date(), resendSyncState: 'SYNCED', resendSyncedAt: new Date(), resendVerifiedAt: new Date() },
    })
    await recordConsentEvent(tx, {
      subscriberId: current.id,
      identity,
      action: 'PREFERENCES_UPDATED',
      source: 'resend_webhook',
      weeklyDigest: topics.weekly,
      specialAlerts: topics.alerts,
      actor: 'resend',
      detail: { eventId, previous: { weeklyDigest: current.weeklyDigest, specialAlerts: current.specialAlerts }, via: 'resend_preference_page' },
    })
  })
  return 'PROCESSED'
}

async function processEmailEvent(eventId: string, type: string, data: Record<string, unknown>): Promise<Outcome> {
  if (type === 'email.delivered') {
    await bumpCampaign(data.broadcast_id, 'deliveredCount')
    return 'PROCESSED'
  }
  let reason: SuppressionReason | null = null
  if (type === 'email.complained') reason = 'COMPLAINED'
  if (type === 'email.suppressed') reason = 'PROVIDER_SUPPRESSED'
  if (type === 'email.bounced') {
    const bounce = (data.bounce ?? {}) as { type?: unknown }
    // Only hard (permanent) bounces suppress; transient ones are retried by the mail system.
    if (typeof bounce.type === 'string' && /permanent|hard/i.test(bounce.type)) reason = 'BOUNCED'
    await bumpCampaign(data.broadcast_id, 'bouncedCount')
  }
  if (type === 'email.complained') await bumpCampaign(data.broadcast_id, 'complainedCount')
  if (!reason) return type === 'email.bounced' ? 'PROCESSED' : 'IGNORED'
  const recipients = Array.isArray(data.to) ? data.to : []
  for (const recipient of recipients) {
    const identity = normaliseEmail(recipient)
    if (!identity) continue
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscriber:${identity}`}))`
      const sub = await findSubscriber(tx, { email: identity })
      await suppress(tx, sub, identity, reason, eventId)
    })
  }
  return 'PROCESSED'
}

export async function processWebhookEvent(id: string): Promise<'PROCESSED' | 'IGNORED' | 'FAILED' | 'SKIPPED'> {
  const event = await prisma.newsletterWebhookEvent.findUnique({ where: { id } })
  if (!event || event.status === 'PROCESSED' || event.status === 'IGNORED') return 'SKIPPED'
  const payload = event.payload as { type?: string; data?: Record<string, unknown> }
  const type = String(payload.type ?? event.type)
  const data = payload.data ?? {}
  try {
    let outcome: Outcome = 'IGNORED'
    if (type === 'contact.updated' || type === 'contact.deleted') outcome = await processContactEvent(id, type, data)
    else if (type.startsWith('email.')) outcome = await processEmailEvent(id, type, data)
    await prisma.newsletterWebhookEvent.update({ where: { id }, data: { status: outcome, processedAt: new Date(), attempts: { increment: 1 }, lastError: null } })
    return outcome
  } catch (error) {
    await prisma.newsletterWebhookEvent.update({ where: { id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: (error as Error).message.slice(0, 500) } })
    return 'FAILED'
  }
}

/** Reconciliation: events that failed (or were stored but never processed) are retried by the tick. */
export async function retryWebhookEvents(limit = 25): Promise<{ retried: number; failed: number }> {
  const stale = new Date(Date.now() - 60_000)
  const events = await prisma.newsletterWebhookEvent.findMany({
    where: { OR: [{ status: 'FAILED', attempts: { lt: MAX_EVENT_ATTEMPTS } }, { status: 'RECEIVED', receivedAt: { lt: stale } }] },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  })
  let failed = 0
  for (const event of events) if ((await processWebhookEvent(event.id)) === 'FAILED') failed++
  return { retried: events.length, failed }
}

export async function pruneWebhookEvents(now = new Date()): Promise<number> {
  const result = await prisma.newsletterWebhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000) } } })
  return result.count
}
