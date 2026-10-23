/**
 * Keeps Resend Contacts in line with the database (the source of truth).
 *
 * Every change to a subscriber sets resendSyncState = PENDING in the same transaction. `syncSubscriber`
 * pushes the row's current state with compare-and-set (a change made meanwhile stays PENDING for the next
 * pass). Before any send, `prepareAudience` must succeed: all pending rows synced, and every subscribed
 * contact in the Resend segment matched to an ACTIVE row (anything else is unsubscribed in Resend first).
 */
import type { Subscriber } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ProviderError, type MarketingProvider } from './provider'
import { subscriberIdentity } from './subscriptions'

export type SyncResult = 'synced' | 'skipped' | 'stale' | 'failed'

/** Contacts checked topic by topic during reconciliation while the audience is at most this large. */
const TOPIC_AUDIT_LIMIT = 60

export async function syncSubscriber(provider: MarketingProvider, id: string): Promise<SyncResult> {
  const sub = await prisma.subscriber.findUnique({ where: { id } })
  if (!sub || sub.resendSyncState === 'SYNCED') return 'skipped'
  return pushState(provider, sub)
}

async function pushState(provider: MarketingProvider, sub: Subscriber): Promise<SyncResult> {
  const subscribed = sub.status === 'ACTIVE' && (sub.weeklyDigest || sub.specialAlerts)
  // Compare-and-set on everything the push was based on.
  const unchanged = { id: sub.id, status: sub.status, weeklyDigest: sub.weeklyDigest, specialAlerts: sub.specialAlerts, resendSyncState: sub.resendSyncState }
  if (!subscribed && !sub.confirmedAt && !sub.resendContactId) {
    // Never confirmed, so never in Resend: nothing to withdraw.
    const done = await prisma.subscriber.updateMany({ where: unchanged, data: { resendSyncState: 'SYNCED', resendSyncedAt: new Date(), resendSyncError: null } })
    return done.count ? 'synced' : 'stale'
  }
  try {
    const { contactId } = await provider.syncContact({
      email: subscriberIdentity(sub),
      subscribed,
      topics: { weekly: sub.weeklyDigest, alerts: sub.specialAlerts },
      contactId: sub.resendContactId,
    })
    const done = await prisma.subscriber.updateMany({
      where: unchanged,
      data: {
        resendSyncState: 'SYNCED',
        resendSyncedAt: new Date(),
        resendSyncAttempts: 0,
        resendSyncError: null,
        ...(contactId ? { resendContactId: contactId } : {}),
      },
    })
    return done.count ? 'synced' : 'stale'
  } catch (error) {
    const permanent = error instanceof ProviderError && !error.retryable
    const message = (error as Error).message.slice(0, 300)
    await prisma.subscriber.updateMany({
      where: { id: sub.id },
      data: { resendSyncState: 'FAILED', resendSyncAttempts: { increment: 1 }, resendSyncError: `${permanent ? 'permanent' : 'retryable'}: ${message}` },
    })
    return 'failed'
  }
}

export async function syncPendingSubscribers(provider: MarketingProvider, limit = 50): Promise<{ synced: number; failed: number }> {
  const rows = await prisma.subscriber.findMany({
    where: { resendSyncState: { in: ['PENDING', 'FAILED'] } },
    orderBy: [{ resendSyncAttempts: 'asc' }, { preferencesUpdatedAt: 'asc' }],
    take: limit,
  })
  let synced = 0
  let failed = 0
  for (const row of rows) {
    const result = await pushState(provider, row)
    if (result === 'synced') synced++
    if (result === 'failed') failed++
  }
  return { synced, failed }
}

/**
 * Rows whose Resend copy may still be more permissive than the database. Any of these blocks a send.
 * The only exception: an ACTIVE row Resend permanently refused to create (it cannot be in Resend at all).
 */
export async function unsyncedBlockingCount(): Promise<number> {
  return prisma.subscriber.count({
    where: {
      resendSyncState: { not: 'SYNCED' },
      NOT: { status: 'ACTIVE', resendContactId: null, resendSyncError: { startsWith: 'permanent:' } },
    },
  })
}

export interface ReconcileReport {
  segmentContacts: number
  strayContactsUnsubscribed: number
  topicMismatchesFixed: number
  contactIdsHealed: number
}

/**
 * Makes the Resend segment safe to broadcast to. Throws (and the send is held) if anything cannot be
 * verified or fixed.
 */
async function reconcileAudience(provider: MarketingProvider): Promise<ReconcileReport> {
  const contacts = await provider.listSegmentContacts()
  const active = await prisma.subscriber.findMany({
    where: { status: 'ACTIVE', OR: [{ weeklyDigest: true }, { specialAlerts: true }] },
  })
  const byIdentity = new Map(active.map((s) => [subscriberIdentity(s), s]))
  const report: ReconcileReport = { segmentContacts: contacts.length, strayContactsUnsubscribed: 0, topicMismatchesFixed: 0, contactIdsHealed: 0 }
  const subscribed = contacts.filter((c) => !c.unsubscribed)
  const auditTopics = subscribed.length <= TOPIC_AUDIT_LIMIT

  for (const contact of subscribed) {
    const sub = byIdentity.get(contact.email.trim().toLowerCase())
    if (!sub) {
      // In Resend and able to receive, but not an active subscriber here (erased account, withdrawn
      // consent we never managed to push, a contact added by hand): switch it off before anything is sent.
      await provider.syncContact({ email: contact.email, subscribed: false, topics: { weekly: false, alerts: false }, contactId: contact.id })
      report.strayContactsUnsubscribed++
      continue
    }
    if (sub.resendContactId !== contact.id) {
      try {
        await prisma.subscriber.update({ where: { id: sub.id }, data: { resendContactId: contact.id } })
        report.contactIdsHealed++
      } catch {
        // Another row already holds this id; leave it for an operator rather than guess.
      }
    }
    if (auditTopics) {
      const topics = await provider.getContactTopics({ contactId: contact.id, email: contact.email })
      // Unknown counts as a mismatch: the topic defaults must never be what decides who receives mail.
      if (topics.weekly !== sub.weeklyDigest || topics.alerts !== sub.specialAlerts) {
        await provider.syncContact({ email: contact.email, subscribed: true, topics: { weekly: sub.weeklyDigest, alerts: sub.specialAlerts }, contactId: contact.id })
        report.topicMismatchesFixed++
      }
    }
  }
  return report
}

/** Everything that must hold before a broadcast leaves. Throws a retryable error otherwise. */
export async function prepareAudience(provider: MarketingProvider): Promise<ReconcileReport> {
  await syncPendingSubscribers(provider, 500)
  const blocking = await unsyncedBlockingCount()
  if (blocking > 0) throw new ProviderError(`${blocking} subscriber change(s) not yet synced to Resend`, true)
  return reconcileAudience(provider)
}
