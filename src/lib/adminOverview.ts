/**
 * The administrator's overview: a handful of counts that answer "is anything waiting on me, and
 * is the system healthy?", plus the rule that turns them into a short attention list.
 *
 * Every number is independent: one failing query shows "unavailable" for that tile instead of
 * hiding the others or pretending the value is zero.
 */
import { prisma } from '@/lib/prisma'
import { DEBATE_OWN_STATE_PUBLISHED_WHERE } from '@/lib/debateVisibility'
import { deploymentReadiness } from '@/lib/deploymentReadiness'
import { testingConfigurationError } from '@/lib/testingMode'

export type Count = number | null

export interface AdminOverview {
  content: { published: Count; drafts: Count; pendingReview: Count; scheduledOverdue: Count; trashed: Count }
  debates: { published: Count; unpublished: Count; deleted: Count }
  team: { staff: Count; needProfile: Count; pendingInvites: Count }
  audience: { subscribers: Count; newLast30Days: Count }
  security: { failedSignIns24h: Count }
  system: {
    /** null: the readiness check itself could not run. */
    deploymentHealthy: boolean | null
    deploymentGaps: string[]
    testingReady: boolean
    testingReason: string | null
  }
}

export interface AttentionItem {
  id: string
  message: string
  href: string
  tone: 'warn' | 'info'
}

const FAILED_SIGN_IN_ALERT = 10
const OVERDUE_MINUTES = 15

const safe = async (promise: Promise<number>): Promise<Count> => {
  try {
    return await promise
  } catch (error) {
    console.error('[admin-overview] metric unavailable', error)
    return null
  }
}

export async function loadAdminOverview(db: typeof prisma = prisma, now: Date = new Date()): Promise<AdminOverview> {
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const overdue = new Date(now.getTime() - OVERDUE_MINUTES * 60 * 1000)

  const [published, drafts, pendingReview, scheduledOverdue, trashed] = await Promise.all([
    safe(db.article.count({ where: { status: 'PUBLISHED', deletedAt: null, isDebate: false } })),
    safe(db.article.count({ where: { status: 'DRAFT', deletedAt: null } })),
    safe(db.article.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } })),
    safe(db.article.count({ where: { status: 'SCHEDULED', deletedAt: null, scheduledAt: { lt: overdue } } })),
    safe(db.article.count({ where: { deletedAt: { not: null } } })),
  ])
  const [dPublished, dUnpublished, dDeleted] = await Promise.all([
    // The administrative lifecycle state of the debate itself (an editor may separately have taken an article out of view).
    safe(db.debate.count({ where: DEBATE_OWN_STATE_PUBLISHED_WHERE })),
    safe(db.debate.count({ where: { deletedAt: null, unpublishedAt: { not: null } } })),
    safe(db.debate.count({ where: { deletedAt: { not: null } } })),
  ])
  const staffWhere = { role: { in: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'] as ('ADMIN' | 'EDITOR' | 'WRITER' | 'GROWTH')[] }, isActive: true, isBanned: false }
  const [staff, needProfile, pendingInvites] = await Promise.all([
    safe(db.user.count({ where: staffWhere })),
    safe(db.user.count({ where: { ...staffWhere, teamProfile: null } })),
    safe(db.teamMembership.count({ where: { status: 'PENDING' } })),
  ])
  const [subscribers, newSubscribers, failedSignIns] = await Promise.all([
    safe(db.subscriber.count()),
    safe(db.subscriber.count({ where: { subscribedAt: { gte: month } } })),
    safe(db.loginAttempt.count({ where: { success: false, createdAt: { gte: day } } })),
  ])

  let deploymentHealthy: boolean | null = null
  let deploymentGaps: string[] = []
  try {
    const readiness = await deploymentReadiness(db)
    deploymentHealthy = readiness.healthy
    deploymentGaps = readiness.gaps
  } catch (error) {
    console.error('[admin-overview] readiness check failed', error)
  }
  const testingReason = testingConfigurationError()

  return {
    content: { published, drafts, pendingReview, scheduledOverdue, trashed },
    debates: { published: dPublished, unpublished: dUnpublished, deleted: dDeleted },
    team: { staff, needProfile, pendingInvites },
    audience: { subscribers, newLast30Days: newSubscribers },
    security: { failedSignIns24h: failedSignIns },
    system: { deploymentHealthy, deploymentGaps, testingReady: testingReason === null, testingReason },
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The short list of things that are waiting on an administrator, most urgent first. */
export function buildAttentionItems(o: AdminOverview): AttentionItem[] {
  const items: AttentionItem[] = []
  if (o.system.deploymentHealthy === false) {
    items.push({
      id: 'deployment',
      message: `Deployment checks are failing: ${o.system.deploymentGaps.slice(0, 2).join('; ')}${o.system.deploymentGaps.length > 2 ? '…' : ''}`,
      href: '/admin/testing',
      tone: 'warn',
    })
  }
  if ((o.content.scheduledOverdue ?? 0) > 0) {
    items.push({ id: 'overdue', message: `${plural(o.content.scheduledOverdue!, 'scheduled article is', 'scheduled articles are')} overdue`, href: '/editorial/scheduled', tone: 'warn' })
  }
  if ((o.content.pendingReview ?? 0) > 0) {
    items.push({ id: 'review', message: `${plural(o.content.pendingReview!, 'article is', 'articles are')} waiting for review`, href: '/editorial/review', tone: 'warn' })
  }
  if ((o.team.needProfile ?? 0) > 0) {
    items.push({ id: 'profiles', message: `${plural(o.team.needProfile!, 'team account has', 'team accounts have')} no public profile`, href: '/editorial/members', tone: 'warn' })
  }
  if ((o.security.failedSignIns24h ?? 0) >= FAILED_SIGN_IN_ALERT) {
    items.push({ id: 'signins', message: `${o.security.failedSignIns24h} failed sign-ins in the last 24 hours`, href: '/admin/login-attempts', tone: 'warn' })
  }
  if ((o.team.pendingInvites ?? 0) > 0) {
    items.push({ id: 'invites', message: `${plural(o.team.pendingInvites!, 'invitation is', 'invitations are')} waiting to be claimed`, href: '/editorial/members', tone: 'info' })
  }
  return items
}
