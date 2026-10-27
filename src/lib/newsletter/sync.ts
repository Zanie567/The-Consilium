/**
 * Keeps Resend Contacts in line with the database (the source of truth for consent).
 *
 * Who a topic broadcast reaches is decided by Resend's state for each segment contact: not globally
 * unsubscribed, and opted in to the topic. Before any send, `prepareAudience` establishes, for the WHOLE
 * segment (every page, no size limit):
 *   1. every database change has been pushed (resendSyncState = SYNCED); a push sets the global flag and both
 *      topics explicitly, so topic defaults never decide anything;
 *   2. every contact that can receive mail maps to an ACTIVE confirmed row; any other is switched off first;
 *   3. every ACTIVE row is present in the segment (a missing one is re-pushed, so nobody is silently skipped);
 *   4. every ACTIVE row's topics were confirmed against Resend within AUDIT_MAX_AGE (by a push, a webhook or
 *      the rolling topic audit). The hourly tick audits the least recently verified contacts within a time
 *      budget, so with ~2 requests/second a 1,000-contact list is fully re-verified every few hours.
 * Anything not yet true makes the send WAIT (AudienceNotReady), never fail or go out to a guessed audience.
 *
 * Drift found in Resend is resolved in the safe direction only: Resend more permissive than the database ->
 * Resend is corrected; Resend less permissive (a withdrawal made on Resend's page whose webhook was lost) ->
 * the withdrawal is adopted here and recorded. Nobody is ever opted back in from Resend's side by an audit.
 */
import type { Subscriber } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordConsentEvent } from './consent'
import { ProviderError, type MarketingProvider } from './provider'
import { subscriberIdentity, unsubscribeInTx } from './subscriptions'

export type SyncResult = 'synced' | 'skipped' | 'stale' | 'failed'

/** An ACTIVE contact's topics must have been confirmed against Resend at least this recently before a send. */
export const AUDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const BATCH = 100

/** The audience is not provably correct yet; the send waits and is retried, it does not count as a failure. */
export class AudienceNotReady extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudienceNotReady'
  }
}

const timeLeft = (deadline: number) => deadline - Date.now() > 0

export async function syncSubscriber(provider: MarketingProvider, id: string): Promise<SyncResult> {
  const sub = await prisma.subscriber.findUnique({ where: { id } })
  if (!sub || sub.resendSyncState === 'SYNCED') return 'skipped'
  return pushState(provider, sub)
}

async function pushState(provider: MarketingProvider, sub: Subscriber): Promise<SyncResult> {
  const subscribed = sub.status === 'ACTIVE' && (sub.weeklyDigest || sub.specialAlerts)
  // Compare-and-set on everything the push was based on: a change made meanwhile stays PENDING.
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
    const now = new Date()
    const done = await prisma.subscriber.updateMany({
      where: unchanged,
      data: {
        resendSyncState: 'SYNCED',
        resendSyncedAt: now,
        resendVerifiedAt: now,
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

/** Pushes pending changes until none are left or the deadline passes. */
export async function syncPendingSubscribers(provider: MarketingProvider, options: { deadline?: number } = {}): Promise<{ synced: number; failed: number }> {
  const deadline = options.deadline ?? Date.now() + 60_000
  let synced = 0
  let failed = 0
  const tried = new Set<string>()
  while (timeLeft(deadline)) {
    const rows = await prisma.subscriber.findMany({
      where: { resendSyncState: { in: ['PENDING', 'FAILED'] }, id: { notIn: [...tried] } },
      orderBy: [{ resendSyncAttempts: 'asc' }, { preferencesUpdatedAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
    })
    if (rows.length === 0) break
    for (const row of rows) {
      if (!timeLeft(deadline)) break
      tried.add(row.id)
      const result = await pushState(provider, row)
      if (result === 'synced') synced++
      if (result === 'failed') failed++
    }
  }
  return { synced, failed }
}

/**
 * Rows whose Resend copy may be wrong. Any of these makes a send wait. The only exception: an ACTIVE row
 * Resend permanently refused to create (it cannot be in Resend at all, so it cannot be mailed wrongly).
 */
export async function unsyncedBlockingCount(): Promise<number> {
  return prisma.subscriber.count({
    where: {
      resendSyncState: { not: 'SYNCED' },
      NOT: { status: 'ACTIVE', resendContactId: null, resendSyncError: { startsWith: 'permanent:' } },
    },
  })
}

/** Adopts a withdrawal Resend has and we do not (its webhook was lost). Only for rows with nothing pending. */
async function adoptWithdrawal(sub: Subscriber, topics: { weekly: boolean; alerts: boolean } | 'global', reason: string) {
  await prisma.$transaction(async (tx) => {
    const identity = subscriberIdentity(sub)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscriber:${identity}`}))`
    const current = await tx.subscriber.findUniqueOrThrow({ where: { id: sub.id } })
    if (current.status !== 'ACTIVE' || current.resendSyncState !== 'SYNCED') return
    if (topics === 'global' || (!topics.weekly && !topics.alerts)) {
      await unsubscribeInTx(tx, current, 'resend_webhook', {}, new Date(), 'resend-reconcile')
      // Resend already has it withdrawn: nothing to push.
      await tx.subscriber.update({ where: { id: current.id }, data: { resendSyncState: 'SYNCED', resendVerifiedAt: new Date() } })
      return
    }
    await tx.subscriber.update({
      where: { id: current.id },
      data: { weeklyDigest: topics.weekly, specialAlerts: topics.alerts, preferencesUpdatedAt: new Date(), resendVerifiedAt: new Date() },
    })
    await recordConsentEvent(tx, {
      subscriberId: current.id,
      identity,
      action: 'PREFERENCES_UPDATED',
      source: 'resend_webhook',
      weeklyDigest: topics.weekly,
      specialAlerts: topics.alerts,
      actor: 'resend-reconcile',
      detail: { reason, previous: { weeklyDigest: current.weeklyDigest, specialAlerts: current.specialAlerts } },
    })
  })
}

export interface ReconcileReport {
  segmentContacts: number
  strayContactsUnsubscribed: number
  withdrawalsAdopted: number
  missingContactsQueued: number
  contactIdsHealed: number
}

/** Full segment scan (all pages). Throws if a stray contact cannot be switched off. */
export async function reconcileSegment(provider: MarketingProvider): Promise<ReconcileReport> {
  const contacts = await provider.listSegmentContacts()
  const active = await prisma.subscriber.findMany({ where: { status: 'ACTIVE', OR: [{ weeklyDigest: true }, { specialAlerts: true }] } })
  const byIdentity = new Map(active.map((s) => [subscriberIdentity(s), s]))
  const present = new Set<string>()
  const report: ReconcileReport = { segmentContacts: contacts.length, strayContactsUnsubscribed: 0, withdrawalsAdopted: 0, missingContactsQueued: 0, contactIdsHealed: 0 }

  for (const contact of contacts) {
    const identity = contact.email.trim().toLowerCase()
    const sub = byIdentity.get(identity)
    if (!sub) {
      if (!contact.unsubscribed) {
        // Can receive mail but is not an active subscriber here (erased account, a withdrawal we never
        // managed to push, a contact added by hand): switch it off before anything is sent.
        await provider.syncContact({ email: contact.email, subscribed: false, topics: { weekly: false, alerts: false }, contactId: contact.id })
        report.strayContactsUnsubscribed++
      }
      continue
    }
    if (contact.unsubscribed) {
      if (sub.resendSyncState === 'SYNCED') {
        await adoptWithdrawal(sub, 'global', 'contact globally unsubscribed in Resend')
        report.withdrawalsAdopted++
      }
      continue
    }
    present.add(identity)
    if (sub.resendContactId !== contact.id) {
      try {
        await prisma.subscriber.update({ where: { id: sub.id }, data: { resendContactId: contact.id } })
        report.contactIdsHealed++
      } catch {
        // Another row already holds this id; leave it for an operator rather than guess.
      }
    }
  }
  // Active, nothing pending, yet not receivable in the segment: push again so they are not skipped.
  const missing = active.filter((s) => s.resendSyncState === 'SYNCED' && !present.has(subscriberIdentity(s)))
  for (const sub of missing) {
    const queued = await prisma.subscriber.updateMany({ where: { id: sub.id, resendSyncState: 'SYNCED', status: 'ACTIVE' }, data: { resendSyncState: 'PENDING' } })
    report.missingContactsQueued += queued.count
  }
  return report
}

export interface AuditReport {
  audited: number
  resendCorrected: number
  withdrawalsAdopted: number
}

/**
 * Rolling topic audit: confirms each ACTIVE contact's topics in Resend, least recently verified first,
 * until the deadline. With `olderThan`, only contacts not verified since then.
 */
export async function auditTopics(provider: MarketingProvider, options: { deadline: number; olderThan?: Date }): Promise<AuditReport> {
  const report: AuditReport = { audited: 0, resendCorrected: 0, withdrawalsAdopted: 0 }
  const done = new Set<string>()
  while (timeLeft(options.deadline)) {
    const rows = await prisma.subscriber.findMany({
      where: {
        status: 'ACTIVE',
        resendSyncState: 'SYNCED',
        resendContactId: { not: null },
        id: { notIn: [...done] },
        ...(options.olderThan ? { OR: [{ resendVerifiedAt: null }, { resendVerifiedAt: { lt: options.olderThan } }] } : {}),
      },
      orderBy: [{ resendVerifiedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: BATCH,
    })
    if (rows.length === 0) break
    for (const sub of rows) {
      if (!timeLeft(options.deadline)) break
      done.add(sub.id)
      const topics = await provider.getContactTopics({ contactId: sub.resendContactId, email: subscriberIdentity(sub) })
      report.audited++
      // Per topic: a withdrawal in Resend wins (adopted here); otherwise the database wins (pushed to Resend).
      const target = {
        weekly: sub.weeklyDigest && topics.weekly !== false,
        alerts: sub.specialAlerts && topics.alerts !== false,
      }
      const adopt = target.weekly !== sub.weeklyDigest || target.alerts !== sub.specialAlerts
      const correct = topics.weekly !== target.weekly || topics.alerts !== target.alerts
      if (adopt) {
        await adoptWithdrawal(sub, target, 'topic withdrawn in Resend')
        report.withdrawalsAdopted++
      }
      if (correct && (target.weekly || target.alerts)) {
        await provider.syncContact({ email: subscriberIdentity(sub), subscribed: true, topics: target, contactId: sub.resendContactId })
        report.resendCorrected++
      }
      if (adopt) continue
      await prisma.subscriber.updateMany({ where: { id: sub.id, resendSyncState: 'SYNCED' }, data: { resendVerifiedAt: new Date() } })
    }
  }
  return report
}

/** Contacts that would receive mail but have not been verified recently enough. */
export async function staleVerificationCount(olderThan: Date): Promise<number> {
  return prisma.subscriber.count({
    where: { status: 'ACTIVE', OR: [{ weeklyDigest: true }, { specialAlerts: true }], resendSyncState: 'SYNCED', resendContactId: { not: null }, AND: [{ OR: [{ resendVerifiedAt: null }, { resendVerifiedAt: { lt: olderThan } }] }] },
  })
}

export interface AudienceReport extends ReconcileReport {
  audit: AuditReport
}

/** Everything that must hold before a broadcast leaves; throws AudienceNotReady (wait) otherwise. */
export async function prepareAudience(provider: MarketingProvider, options: { deadline: number }): Promise<AudienceReport> {
  // Verification stamps are wall-clock times, so freshness is judged against the wall clock too.
  const now = new Date()
  await syncPendingSubscribers(provider, { deadline: options.deadline })
  let blocking = await unsyncedBlockingCount()
  if (blocking > 0) throw new AudienceNotReady(`${blocking} subscriber change(s) not yet synced to Resend`)
  const reconcile = await reconcileSegment(provider)
  if (reconcile.missingContactsQueued > 0) {
    await syncPendingSubscribers(provider, { deadline: options.deadline })
    blocking = await unsyncedBlockingCount()
    if (blocking > 0) throw new AudienceNotReady(`${blocking} subscriber(s) missing from the Resend segment are still being added`)
  }
  const olderThan = new Date(now.getTime() - AUDIT_MAX_AGE_MS)
  const audit = await auditTopics(provider, { deadline: options.deadline, olderThan })
  const stale = await staleVerificationCount(olderThan)
  if (stale > 0) throw new AudienceNotReady(`${stale} subscriber(s) still awaiting topic verification in Resend`)
  return { ...reconcile, audit }
}
