/** Read models for the editorial newsletter pages (no subscriber addresses ever leave this module). */
import type { NewsletterCampaign, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAllowedRole, NEWSLETTER_APPROVE_ROLES, NEWSLETTER_EDIT_ROLES, NEWSLETTER_PAUSE_ROLES } from '@/lib/rbac'
import { renderCampaign } from './campaigns'
import { resolveDelivery } from './config'
import { readContent } from './edition'
import { currentWeeklySlot } from './schedule'
import { isNewsletterPaused, isWeeklyAutoSendEnabled } from './settings'
import { unsyncedBlockingCount } from './sync'

function permissionsFor(role: Role) {
  return {
    canEdit: isAllowedRole(role, NEWSLETTER_EDIT_ROLES),
    canApprove: isAllowedRole(role, NEWSLETTER_APPROVE_ROLES),
    canPause: isAllowedRole(role, NEWSLETTER_PAUSE_ROLES),
    canUnpause: isAllowedRole(role, NEWSLETTER_APPROVE_ROLES),
  }
}

export function campaignSummary(c: NewsletterCampaign) {
  const content = readContent(c.articles)
  return {
    id: c.id,
    kind: c.kind,
    editionKey: c.editionKey,
    status: c.status,
    subject: c.subject,
    articleCount: content.items.length,
    excludedCount: content.excluded.length,
    scheduledFor: c.scheduledFor?.toISOString() ?? null,
    sentAt: c.sentAt?.toISOString() ?? null,
    approvedByName: c.approvedByName,
    createdAt: c.createdAt.toISOString(),
    blockedReason: c.blockedReason,
    lastError: c.lastError,
    nextAttemptAt: c.nextAttemptAt?.toISOString() ?? null,
    recipientCount: c.recipientCount,
    deliveredCount: c.deliveredCount,
    bouncedCount: c.bouncedCount,
    complainedCount: c.complainedCount,
  }
}

export async function newsletterOverview(role: Role, now = new Date()) {
  const [campaigns, paused, autoSend, statusCounts, weekly, alerts, unsynced] = await Promise.all([
    prisma.newsletterCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    isNewsletterPaused(),
    isWeeklyAutoSendEnabled(),
    prisma.subscriber.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.subscriber.count({ where: { status: 'ACTIVE', weeklyDigest: true } }),
    prisma.subscriber.count({ where: { status: 'ACTIVE', specialAlerts: true } }),
    unsyncedBlockingCount(),
  ])
  const delivery = resolveDelivery()
  const slot = currentWeeklySlot(now)
  const nextSlot = now < slot.cutoff ? slot : currentWeeklySlot(new Date(slot.sendAt.getTime() + 7 * 24 * 60 * 60 * 1000))
  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]))
  return {
    campaigns: campaigns.map(campaignSummary),
    settings: { paused, autoSend },
    delivery: delivery.mode === 'disabled' ? { mode: 'disabled' as const, reason: delivery.reason } : { mode: delivery.mode },
    audience: {
      active: counts.ACTIVE ?? 0,
      weekly,
      alerts,
      pending: counts.PENDING ?? 0,
      legacy: counts.LEGACY ?? 0,
      unsubscribed: counts.UNSUBSCRIBED ?? 0,
      suppressed: counts.SUPPRESSED ?? 0,
      unsynced,
    },
    schedule: { editionKey: nextSlot.editionKey, sendAt: nextSlot.sendAt.toISOString(), cutoff: nextSlot.cutoff.toISOString() },
    permissions: permissionsFor(role),
  }
}

export async function campaignDetail(id: string, role: Role) {
  const campaign = await prisma.newsletterCampaign.findUnique({ where: { id } })
  if (!campaign) return null
  const rendered = renderCampaign(campaign, { unsubscribeUrl: '#unsubscribe-preview' })
  const audit = await prisma.auditLog.findMany({ where: { targetId: id, targetType: 'newsletter_campaign' }, orderBy: { createdAt: 'desc' }, take: 100 })
  const actorIds = [...new Set(audit.map((a) => a.performedBy).filter((v) => !v.startsWith('system')))]
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : []
  const names = new Map(actors.map((a) => [a.id, a.name]))
  return {
    campaign: {
      ...campaignSummary(campaign),
      previewText: campaign.previewText,
      intro: campaign.intro,
      contentHash: campaign.contentHash,
      approvedAt: campaign.approvedAt?.toISOString() ?? null,
      cancelReason: campaign.cancelReason,
      windowStart: campaign.windowStart?.toISOString() ?? null,
      windowEnd: campaign.windowEnd?.toISOString() ?? null,
      sendAttempts: campaign.sendAttempts,
      resendBroadcastId: campaign.resendBroadcastId,
      createdByName: campaign.createdByName,
    },
    content: rendered.content,
    previewHtml: rendered.html,
    previewText: rendered.text,
    audit: audit.map((a) => ({
      id: a.id,
      action: a.action.replace('newsletter.campaign.', ''),
      at: a.createdAt.toISOString(),
      actor: a.performedBy.startsWith('system') ? ((a.metadata as { actorName?: string } | null)?.actorName ?? 'Scheduler') : (names.get(a.performedBy) ?? 'Former staff member'),
      metadata: a.metadata,
    })),
    permissions: permissionsFor(role),
  }
}
