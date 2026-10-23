/**
 * One idempotent pass of the newsletter scheduler, run by POST /api/cron/newsletter (hourly once
 * activated). Safe to run concurrently or repeatedly: building uses the editionKey unique constraint and
 * sending uses the claim/lease in campaigns.ts. Returns counts only (no addresses, no titles).
 */
import { prisma } from '@/lib/prisma'
import { approveCampaign, ensureWeeklyEdition, runDueCampaigns, type RunReport } from './campaigns'
import { PENDING_RETENTION_DAYS } from './config'
import { getMarketingProvider } from './provider'
import { isNewsletterPaused, isWeeklyAutoSendEnabled } from './settings'
import { syncPendingSubscribers } from './sync'
import { pruneWebhookEvents, retryWebhookEvents } from './webhooks'

const DAY_MS = 24 * 60 * 60 * 1000
const CONSENT_RECORD_RETENTION_DAYS = 730
const UNSUBSCRIBED_RETENTION_DAYS = 730

export interface TickSummary {
  ranAt: string
  paused: boolean
  delivery: 'available' | 'disabled'
  sync?: { synced: number; failed: number } | { error: string }
  webhooks?: { retried: number; failed: number } | { error: string }
  weekly: { editionKey: string; state: string; status?: string; autoApproved?: boolean; autoApproveError?: string }
  sends: Pick<RunReport, 'paused' | 'deliveryDisabled'> & { results: { id: string; outcome: string }[] }
  retention: Record<string, number> | { error: string }
}

async function applyRetention(now = new Date()): Promise<Record<string, number>> {
  const pendingCutoff = new Date(now.getTime() - PENDING_RETENTION_DAYS * DAY_MS)
  const stalePending = await prisma.subscriber.findMany({ where: { status: 'PENDING', confirmedAt: null, subscribedAt: { lt: pendingCutoff } }, select: { id: true }, take: 500 })
  const ids = stalePending.map((s) => s.id)
  const pendingEvents = ids.length ? await prisma.subscriberConsentEvent.deleteMany({ where: { subscriberId: { in: ids } } }) : { count: 0 }
  const pending = ids.length ? await prisma.subscriber.deleteMany({ where: { id: { in: ids }, status: 'PENDING', confirmedAt: null } }) : { count: 0 }
  const tokens = await prisma.subscriberToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } } })
  const unsubscribed = await prisma.subscriber.deleteMany({ where: { status: 'UNSUBSCRIBED', unsubscribedAt: { lt: new Date(now.getTime() - UNSUBSCRIBED_RETENTION_DAYS * DAY_MS) }, resendSyncState: 'SYNCED' } })
  const orphanedConsent = await prisma.subscriberConsentEvent.deleteMany({ where: { subscriberId: null, createdAt: { lt: new Date(now.getTime() - CONSENT_RECORD_RETENTION_DAYS * DAY_MS) } } })
  const webhookEvents = await pruneWebhookEvents(now)
  return {
    unconfirmedSignupsDeleted: pending.count,
    unconfirmedConsentEventsDeleted: pendingEvents.count,
    expiredTokensDeleted: tokens.count,
    unsubscribedRowsDeleted: unsubscribed.count,
    consentRecordsDeleted: orphanedConsent.count,
    webhookEventsDeleted: webhookEvents,
  }
}

export async function runNewsletterTick(now = new Date()): Promise<TickSummary> {
  const paused = await isNewsletterPaused()
  const resolution = getMarketingProvider()
  const summary: TickSummary = {
    ranAt: now.toISOString(),
    paused,
    delivery: resolution.provider ? 'available' : 'disabled',
    weekly: { editionKey: '', state: 'unknown' },
    sends: { paused, results: [] },
    retention: {},
  }

  if (resolution.provider) {
    try {
      summary.sync = await syncPendingSubscribers(resolution.provider, 50)
    } catch (error) {
      summary.sync = { error: (error as Error).message.slice(0, 200) }
    }
  }
  try {
    summary.webhooks = await retryWebhookEvents()
  } catch (error) {
    summary.webhooks = { error: (error as Error).message.slice(0, 200) }
  }

  // Building a draft never sends anything, so it happens even while paused (editors can preview it).
  const weekly = await ensureWeeklyEdition(now)
  summary.weekly = { editionKey: weekly.editionKey, state: weekly.state, ...(weekly.state !== 'not_due' ? { status: weekly.campaign.status } : {}) }
  if (weekly.state !== 'not_due' && weekly.campaign.status === 'DRAFT' && !paused && (await isWeeklyAutoSendEnabled())) {
    try {
      const approved = await approveCampaign(weekly.campaign.id, { id: 'system:auto-send', name: 'Weekly auto-send' }, { expectedHash: weekly.campaign.contentHash }, now)
      summary.weekly = { ...summary.weekly, status: approved.status, autoApproved: true }
    } catch (error) {
      summary.weekly.autoApproveError = (error as Error).message.slice(0, 200)
    }
  }

  const run = await runDueCampaigns(now)
  summary.sends = { paused: run.paused, deliveryDisabled: run.deliveryDisabled, results: run.results.map((r) => ({ id: r.id, outcome: r.outcome })) }

  try {
    summary.retention = await applyRetention(now)
  } catch (error) {
    summary.retention = { error: (error as Error).message.slice(0, 200) }
  }
  return summary
}

