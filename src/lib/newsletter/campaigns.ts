/**
 * Campaign state machine: build -> (edit) -> approve -> send exactly once.
 *
 *   DRAFT ──approve(admin, exact content hash)──> SCHEDULED ──claim(lease)──> SENDING ──> SENT
 *     ^  rebuild/edit                              │ cancel                    │ failure before send -> FAILED (backoff, max attempts)
 *     └──────────── BLOCKED <── fail-closed publication check / caps ──────────┘ outcome unknown -> stays SENDING until the lease
 *                                                                                expires, then Resend's own broadcast state decides
 *
 * Guarantees and where they live:
 *   one send per edition        newsletter_campaigns.editionKey UNIQUE; one weekly in flight (partial unique index)
 *   approval = exact content    CHECK approvedHash = contentHash for SCHEDULED/SENDING/SENT; edits reset to DRAFT
 *   no double send on races     claim is one conditional UPDATE; Resend `send` only while the broadcast is a draft
 *   crash between create/send   broadcast name `consilium:<id>` is looked up before creating another
 *   never unpublished content   verifySnapshotStillPublic at send time (fail closed -> BLOCKED)
 *   never the wrong people      prepareAudience before every send (sync + segment reconciliation)
 *   pause switch                checked before claiming and again after claiming
 */
import { Prisma, type NewsletterCampaign } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  ALERT_DEFAULT_DELAY_MS,
  ALERT_MAX_ARTICLE_AGE_MS,
  ALERT_MAX_PER_30_DAYS,
  ALERT_MIN_INTERVAL_MS,
  ALERT_WEEKLY_BUFFER_MS,
  MAX_SEND_ATTEMPTS,
  PUBLICATION_SAFE_DELAY_MS,
  SEND_BACKOFF_MS,
  SEND_LEASE_MS,
  WEEKLY_MAX_LATENESS_MS,
  WEEKLY_MAX_WINDOW_MS,
  WEEKLY_MIN_GAP_MS,
  resolveDelivery,
} from './config'
import {
  buildAlertContent,
  buildWeeklyContent,
  contentHash,
  readContent,
  verifySnapshotStillPublic,
  type EditionContent,
  type EditionItem,
} from './edition'
import { ProviderError, getMarketingProvider, type MarketingProvider } from './provider'
import { renderNewsletterHtml, renderNewsletterText } from './render'
import { currentWeeklySlot, slotForEditionKey } from './schedule'
import { isNewsletterPaused } from './settings'
import { AudienceNotReady, prepareAudience } from './sync'

export interface Actor {
  id: string
  name: string | null
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Newsletter scheduler' }

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409,
  ) {
    super(message)
    this.name = 'CampaignError'
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const EDITABLE: NewsletterCampaign['status'][] = ['DRAFT', 'SCHEDULED', 'BLOCKED']

async function audit(db: Pick<typeof prisma, 'auditLog'>, action: string, campaign: Pick<NewsletterCampaign, 'id' | 'editionKey' | 'kind'>, actor: Actor, metadata: Record<string, unknown> = {}) {
  await db.auditLog.create({
    data: {
      action: `newsletter.campaign.${action}`,
      targetId: campaign.id,
      targetType: 'newsletter_campaign',
      performedBy: actor.id,
      metadata: { editionKey: campaign.editionKey, kind: campaign.kind, actorName: actor.name, ...metadata } as Prisma.InputJsonValue,
    },
  })
}

export function broadcastName(campaign: Pick<NewsletterCampaign, 'id'>): string {
  return `consilium:${campaign.id}`
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

// ── Content helpers ─────────────────────────────────────────────────────────

function weeklySubject(items: EditionItem[], label: string): string {
  return items.length ? `The Weekly Edition: ${items[0].title}`.slice(0, 150) : `The Weekly Edition, ${label}`
}

function weeklyPreview(items: EditionItem[]): string {
  if (items.length <= 1) return 'New analysis from The Consilium this week.'
  return `Plus ${items.length - 1} more ${items.length === 2 ? 'article' : 'articles'} from The Consilium this week.`
}

export function renderCampaign(campaign: Pick<NewsletterCampaign, 'kind' | 'subject' | 'previewText' | 'intro' | 'articles' | 'editionKey'>, options: { unsubscribeUrl?: string } = {}) {
  const content = readContent(campaign.articles)
  const heading =
    campaign.kind === 'WEEKLY'
      ? `Friday ${slotForEditionKey(campaign.editionKey)?.fridayLabel ?? ''}`.trim()
      : 'A piece our editors think you should not miss'
  const input = { kind: campaign.kind, subject: campaign.subject, previewText: campaign.previewText, intro: campaign.intro, heading, items: content.items }
  return { html: renderNewsletterHtml(input, options), text: renderNewsletterText(input, options), content }
}

async function weeklyWindow(cutoff: Date, now: Date, excludeId?: string): Promise<{ start: Date; end: Date }> {
  const lastSent = await prisma.newsletterCampaign.findFirst({
    where: { kind: 'WEEKLY', status: 'SENT', windowEnd: { not: null, lt: cutoff }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { windowEnd: 'desc' },
    select: { windowEnd: true },
  })
  const earliest = cutoff.getTime() - WEEKLY_MAX_WINDOW_MS
  const start = Math.max(lastSent?.windowEnd?.getTime() ?? cutoff.getTime() - 7 * DAY_MS, earliest)
  const end = Math.min(cutoff.getTime(), now.getTime() - PUBLICATION_SAFE_DELAY_MS)
  return { start: new Date(start), end: new Date(Math.max(end, start)) }
}

// ── Building ────────────────────────────────────────────────────────────────

export type EnsureWeeklyResult =
  | { state: 'not_due'; editionKey: string }
  | { state: 'exists' | 'created'; editionKey: string; campaign: NewsletterCampaign }

/**
 * Creates this week's edition once its cut-off has passed (or immediately with `force`, for an editor's
 * early preview). Idempotent: a second call, or a concurrent one, returns the existing row.
 */
export async function ensureWeeklyEdition(now = new Date(), actor: Actor = SYSTEM_ACTOR, options: { force?: boolean } = {}): Promise<EnsureWeeklyResult> {
  const slot = currentWeeklySlot(now)
  const existing = await prisma.newsletterCampaign.findUnique({ where: { editionKey: slot.editionKey } })
  if (existing) return { state: 'exists', editionKey: slot.editionKey, campaign: existing }
  if (!options.force && now < slot.cutoff) return { state: 'not_due', editionKey: slot.editionKey }

  const late = now.getTime() - slot.sendAt.getTime() > WEEKLY_MAX_LATENESS_MS
  const window = await weeklyWindow(slot.cutoff, now)
  const content: EditionContent = late ? { items: [], excluded: [] } : await buildWeeklyContent(window, now)
  const subject = weeklySubject(content.items, slot.fridayLabel)
  const previewText = weeklyPreview(content.items)
  const skipped = late || content.items.length === 0
  try {
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.newsletterCampaign.create({
        data: {
          kind: 'WEEKLY',
          editionKey: slot.editionKey,
          status: skipped ? 'SKIPPED' : 'DRAFT',
          subject,
          previewText,
          intro: null,
          articles: content as unknown as Prisma.InputJsonValue,
          contentHash: contentHash({ subject, previewText, intro: null, items: content.items }),
          windowStart: window.start,
          windowEnd: window.end,
          createdById: actor.id,
          createdByName: actor.name,
          blockedReason: late ? 'Missed the send window by more than 24 hours; its articles roll into the next edition.' : content.items.length === 0 ? 'No eligible published articles in this edition window.' : null,
        },
      })
      await audit(tx, skipped ? 'skipped' : 'built', created, actor, { items: content.items.length, excluded: content.excluded.length, late })
      return created
    })
    return { state: 'created', editionKey: slot.editionKey, campaign }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const winner = await prisma.newsletterCampaign.findUniqueOrThrow({ where: { editionKey: slot.editionKey } })
    return { state: 'exists', editionKey: slot.editionKey, campaign: winner }
  }
}

export async function rebuildCampaign(id: string, actor: Actor, now = new Date()): Promise<NewsletterCampaign> {
  const campaign = await prisma.newsletterCampaign.findUnique({ where: { id } })
  if (!campaign) throw new CampaignError('Campaign not found.', 'NOT_FOUND', 404)
  const allowed: NewsletterCampaign['status'][] = ['DRAFT', 'SCHEDULED', 'BLOCKED', 'SKIPPED', 'FAILED']
  if (!allowed.includes(campaign.status) || (campaign.status === 'FAILED' && campaign.resendBroadcastId)) {
    throw new CampaignError(`A ${campaign.status.toLowerCase()} campaign cannot be rebuilt.`, 'NOT_REBUILDABLE')
  }
  let content: EditionContent
  let window: { start: Date; end: Date } | null = null
  if (campaign.kind === 'WEEKLY') {
    const slot = slotForEditionKey(campaign.editionKey)
    if (!slot) throw new CampaignError('Invalid edition key.', 'INVALID', 422)
    if (now.getTime() - slot.sendAt.getTime() > WEEKLY_MAX_LATENESS_MS) throw new CampaignError('This edition is more than 24 hours past its send time.', 'TOO_LATE')
    window = await weeklyWindow(slot.cutoff, now, campaign.id)
    content = await buildWeeklyContent(window, now)
  } else {
    const item = campaign.articleId ? await buildAlertContent(campaign.articleId) : null
    content = item && !('reason' in item) ? { items: [item], excluded: [] } : { items: [], excluded: item ? [item] : [] }
  }
  const subject = campaign.subject
  const hash = contentHash({ subject, previewText: campaign.previewText, intro: campaign.intro, items: content.items })
  const empty = content.items.length === 0
  return prisma.$transaction(async (tx) => {
    const updated = await tx.newsletterCampaign.updateMany({
      where: { id, status: campaign.status },
      data: {
        articles: content as unknown as Prisma.InputJsonValue,
        contentHash: hash,
        status: empty ? 'SKIPPED' : 'DRAFT',
        ...(window ? { windowStart: window.start, windowEnd: window.end } : {}),
        approvedAt: null,
        approvedById: null,
        approvedByName: null,
        approvedHash: null,
        scheduledFor: null,
        blockedReason: empty ? 'No eligible published articles.' : null,
        lastError: null,
        nextAttemptAt: null,
        sendAttempts: 0,
      },
    })
    if (updated.count !== 1) throw new CampaignError('The campaign changed meanwhile; reload and try again.', 'CONFLICT')
    await audit(tx, 'rebuilt', campaign, actor, { from: campaign.status, items: content.items.length })
    return tx.newsletterCampaign.findUniqueOrThrow({ where: { id } })
  })
}

/**
 * What editors may change. Article titles, authors, summaries (the published excerpt), images and links are
 * NOT editable here: they are the approved, published article and the send-time check compares against it.
 * Articles can only be left out.
 */
export interface ContentPatch {
  subject?: string
  previewText?: string | null
  intro?: string | null
  removeArticleIds?: string[]
  /** Rejected: kept in the type so a stale client gets a clear error rather than a silent no-op. */
  summaries?: unknown
}

function cleanText(value: unknown, max: number, label: string, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new CampaignError(`${label} is required.`, 'INVALID', 422)
    return null
  }
  if (typeof value !== 'string') throw new CampaignError(`${label} must be text.`, 'INVALID', 422)
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (required && !text) throw new CampaignError(`${label} is required.`, 'INVALID', 422)
  if (text.length > max) throw new CampaignError(`${label} must be at most ${max} characters.`, 'INVALID', 422)
  return text || null
}

/** Editor changes to subject, preview, intro or summaries. Any change returns the campaign to DRAFT. */
export async function updateCampaignContent(id: string, actor: Actor, patch: ContentPatch): Promise<NewsletterCampaign> {
  const campaign = await prisma.newsletterCampaign.findUnique({ where: { id } })
  if (!campaign) throw new CampaignError('Campaign not found.', 'NOT_FOUND', 404)
  if (!EDITABLE.includes(campaign.status)) throw new CampaignError(`A ${campaign.status.toLowerCase()} campaign cannot be edited.`, 'NOT_EDITABLE')
  const content = readContent(campaign.articles)
  const subject = patch.subject === undefined ? campaign.subject : (cleanText(patch.subject, 150, 'Subject', true) as string)
  const previewText = patch.previewText === undefined ? campaign.previewText : cleanText(patch.previewText, 200, 'Preview text')
  const intro = patch.intro === undefined ? campaign.intro : cleanText(patch.intro, 2000, 'Introduction')
  const remove = new Set(Array.isArray(patch.removeArticleIds) ? patch.removeArticleIds.filter((v) => typeof v === 'string') : [])
  if (campaign.kind === 'ALERT' && remove.size) throw new CampaignError('An alert has exactly one article.', 'INVALID', 422)
  if (patch.summaries !== undefined) {
    throw new CampaignError('Article titles, summaries and links come from the published article and cannot be edited here. Edit the article (it is then re-checked) or add an introduction.', 'ARTICLE_CONTENT_LOCKED', 422)
  }
  // Items are carried over untouched from the snapshot taken from the published articles.
  const items = content.items.filter((item) => !remove.has(item.id))
  if (items.length === 0) throw new CampaignError('An edition needs at least one article. Cancel it instead.', 'INVALID', 422)
  const excluded = [...content.excluded, ...content.items.filter((i) => remove.has(i.id)).map((i) => ({ id: i.id, title: i.title, reason: `removed by ${actor.name ?? 'an editor'}` }))]
  const hash = contentHash({ subject, previewText, intro, items })
  if (hash === campaign.contentHash) return campaign
  return prisma.$transaction(async (tx) => {
    const updated = await tx.newsletterCampaign.updateMany({
      where: { id, status: campaign.status, contentHash: campaign.contentHash },
      data: {
        subject,
        previewText,
        intro,
        articles: { items, excluded } as unknown as Prisma.InputJsonValue,
        contentHash: hash,
        status: 'DRAFT',
        approvedAt: null,
        approvedById: null,
        approvedByName: null,
        approvedHash: null,
        scheduledFor: null,
        blockedReason: null,
      },
    })
    if (updated.count !== 1) throw new CampaignError('The campaign changed meanwhile; reload and try again.', 'CONFLICT')
    await audit(tx, 'edited', campaign, actor, { from: campaign.status, removed: [...remove], subjectChanged: subject !== campaign.subject, introChanged: intro !== campaign.intro })
    return tx.newsletterCampaign.findUniqueOrThrow({ where: { id } })
  })
}

// ── Caps ────────────────────────────────────────────────────────────────────

/** Why an alert may not go out at `sendAt`, or null. */
async function alertCapProblem(sendAt: Date, excludeId?: string): Promise<string | null> {
  const others = await prisma.newsletterCampaign.findMany({
    where: { kind: 'ALERT', status: { in: ['SENT', 'SENDING', 'SCHEDULED'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { sentAt: true, scheduledFor: true },
  })
  const times = others.map((o) => (o.sentAt ?? o.scheduledFor)?.getTime()).filter((t): t is number => typeof t === 'number')
  const t = sendAt.getTime()
  if (times.some((other) => Math.abs(other - t) < ALERT_MIN_INTERVAL_MS)) return 'Only one special alert can go out in any 7-day period.'
  if (times.filter((other) => other > t - 30 * DAY_MS && other <= t).length >= ALERT_MAX_PER_30_DAYS) return `At most ${ALERT_MAX_PER_30_DAYS} special alerts can go out in any 30 days.`
  const weekly = await prisma.newsletterCampaign.findMany({
    where: { kind: 'WEEKLY', status: { in: ['SENT', 'SENDING', 'SCHEDULED'] } },
    select: { sentAt: true, scheduledFor: true },
  })
  const weeklyTimes = weekly.map((w) => (w.sentAt ?? w.scheduledFor)?.getTime()).filter((v): v is number => typeof v === 'number')
  const slots = [currentWeeklySlot(sendAt).sendAt.getTime(), currentWeeklySlot(new Date(t + 7 * DAY_MS)).sendAt.getTime()]
  if ([...weeklyTimes, ...slots].some((w) => Math.abs(w - t) < ALERT_WEEKLY_BUFFER_MS)) return 'Special alerts cannot go out within 12 hours of a weekly edition.'
  return null
}

async function weeklyGapProblem(sendAt: Date, excludeId: string): Promise<string | null> {
  const recent = await prisma.newsletterCampaign.findFirst({
    where: { kind: 'WEEKLY', status: { in: ['SENT', 'SENDING'] }, id: { not: excludeId }, sentAt: { gt: new Date(sendAt.getTime() - WEEKLY_MIN_GAP_MS) } },
    select: { editionKey: true },
  })
  return recent ? `Another weekly edition (${recent.editionKey}) went out less than 5 days ago.` : null
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export async function createAlertCampaign(articleId: unknown, actor: Actor, now = new Date()): Promise<NewsletterCampaign> {
  if (typeof articleId !== 'string' || !articleId || articleId.length > 64) throw new CampaignError('Choose an article.', 'INVALID', 422)
  const item = await buildAlertContent(articleId)
  if (!item) throw new CampaignError('Only a publicly published article can be sent as a special alert.', 'NOT_PUBLIC', 422)
  if ('reason' in item) throw new CampaignError(`This article cannot be sent: ${item.reason}.`, 'NOT_SENDABLE', 422)
  if (now.getTime() - new Date(item.publishedAt).getTime() > ALERT_MAX_ARTICLE_AGE_MS) {
    throw new CampaignError('Special alerts are only for articles published in the last 72 hours.', 'TOO_OLD', 422)
  }
  const subject = `Special article: ${item.title}`.slice(0, 150)
  const previewText = (item.summary ?? `New from ${item.author}`).slice(0, 200)
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.newsletterCampaign.create({
        data: {
          kind: 'ALERT',
          editionKey: `alert:${articleId}`,
          articleId,
          status: 'DRAFT',
          subject,
          previewText,
          articles: { items: [item], excluded: [] } as unknown as Prisma.InputJsonValue,
          contentHash: contentHash({ subject, previewText, intro: null, items: [item] }),
          createdById: actor.id,
          createdByName: actor.name,
        },
      })
      await audit(tx, 'alert_created', created, actor, { articleId })
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new CampaignError('A special alert already exists for this article.', 'DUPLICATE')
    throw error
  }
}

// ── Approval and cancellation ───────────────────────────────────────────────

export async function approveCampaign(
  id: string,
  actor: Actor,
  input: { expectedHash: unknown; scheduledFor?: unknown },
  now = new Date(),
): Promise<NewsletterCampaign> {
  const campaign = await prisma.newsletterCampaign.findUnique({ where: { id } })
  if (!campaign) throw new CampaignError('Campaign not found.', 'NOT_FOUND', 404)
  if (campaign.status !== 'DRAFT') throw new CampaignError(`Only a draft can be approved (this one is ${campaign.status.toLowerCase()}).`, 'NOT_DRAFT')
  if (typeof input.expectedHash !== 'string' || input.expectedHash !== campaign.contentHash) {
    throw new CampaignError('The content changed since you previewed it. Review the new version before approving.', 'STALE_PREVIEW')
  }
  if (readContent(campaign.articles).items.length === 0) throw new CampaignError('An empty edition cannot be approved.', 'INVALID', 422)
  if (campaign.kind === 'WEEKLY') {
    const slot = slotForEditionKey(campaign.editionKey)
    if (!slot || now.getTime() - slot.sendAt.getTime() > WEEKLY_MAX_LATENESS_MS) {
      throw new CampaignError('This edition is more than 24 hours past its Friday send time. Its articles roll into the next edition.', 'TOO_LATE')
    }
  }

  let sendAt: Date
  if (input.scheduledFor !== undefined && input.scheduledFor !== null && input.scheduledFor !== '') {
    const requested = new Date(String(input.scheduledFor))
    if (Number.isNaN(requested.getTime())) throw new CampaignError('Invalid send time.', 'INVALID', 422)
    if (requested.getTime() < now.getTime() - 60_000) throw new CampaignError('The send time is in the past.', 'INVALID', 422)
    if (requested.getTime() > now.getTime() + 14 * DAY_MS) throw new CampaignError('Schedule at most 14 days ahead.', 'INVALID', 422)
    sendAt = requested
  } else if (campaign.kind === 'WEEKLY') {
    const slot = slotForEditionKey(campaign.editionKey)
    sendAt = slot && slot.sendAt > now ? slot.sendAt : now
  } else {
    sendAt = new Date(now.getTime() + ALERT_DEFAULT_DELAY_MS)
  }
  if (sendAt < now) sendAt = now
  // Never before every article has been public for the safe delay (the send-time check would block it).
  const earliest = Math.max(...readContent(campaign.articles).items.map((i) => new Date(i.publishedAt).getTime() + PUBLICATION_SAFE_DELAY_MS))
  if (sendAt.getTime() < earliest) sendAt = new Date(earliest)
  const problem = campaign.kind === 'ALERT' ? await alertCapProblem(sendAt, campaign.id) : await weeklyGapProblem(sendAt, campaign.id)
  if (problem) throw new CampaignError(problem, 'CAPPED')

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.newsletterCampaign.updateMany({
        where: { id, status: 'DRAFT', contentHash: input.expectedHash as string },
        data: { status: 'SCHEDULED', approvedAt: now, approvedById: actor.id, approvedByName: actor.name, approvedHash: input.expectedHash as string, scheduledFor: sendAt, blockedReason: null },
      })
      if (updated.count !== 1) throw new CampaignError('The campaign changed meanwhile; reload and try again.', 'CONFLICT')
      await audit(tx, 'approved', campaign, actor, { scheduledFor: sendAt.toISOString(), contentHash: campaign.contentHash })
      return tx.newsletterCampaign.findUniqueOrThrow({ where: { id } })
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new CampaignError('Another weekly edition is already scheduled or sending.', 'ANOTHER_ACTIVE')
    throw error
  }
}

export async function cancelCampaign(id: string, actor: Actor, reason: unknown): Promise<NewsletterCampaign> {
  const campaign = await prisma.newsletterCampaign.findUnique({ where: { id } })
  if (!campaign) throw new CampaignError('Campaign not found.', 'NOT_FOUND', 404)
  const cancellable: NewsletterCampaign['status'][] = ['DRAFT', 'SCHEDULED', 'BLOCKED', 'FAILED', 'SKIPPED']
  if (!cancellable.includes(campaign.status)) throw new CampaignError(`A ${campaign.status.toLowerCase()} campaign cannot be cancelled.`, 'NOT_CANCELLABLE')
  const note = cleanText(reason, 500, 'Reason')
  return prisma.$transaction(async (tx) => {
    const updated = await tx.newsletterCampaign.updateMany({
      where: { id, status: campaign.status },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancelReason: note, nextAttemptAt: null, leaseUntil: null },
    })
    if (updated.count !== 1) throw new CampaignError('The campaign changed meanwhile (it may be sending); reload.', 'CONFLICT')
    await audit(tx, 'cancelled', campaign, actor, { from: campaign.status, reason: note })
    return tx.newsletterCampaign.findUniqueOrThrow({ where: { id } })
  })
}

// ── Sending ─────────────────────────────────────────────────────────────────
//
// Exactly-once, without relying on the database alone:
//   * the broadcast id is persisted the moment Resend returns it, and set ONCE (a second id can never be
//     stored for a campaign), so every later attempt works on the same Resend broadcast;
//   * `sendRequestedAt` is persisted BEFORE the send request; afterwards Resend's own broadcast status
//     decides: anything but `draft` means it went out and is recorded as sent, never sent again;
//   * a Resend broadcast can only be sent once (sending a non-draft is refused), so even a repeated send
//     request for the same id cannot produce a second email;
//   * a crash between "created" and "id saved" leaves at most an orphan DRAFT (never sent); the next attempt
//     looks the broadcast up by its unique name `consilium:<campaignId>` before creating another;
//   * every write after the claim is fenced on (status SENDING, sendAttempts = this attempt): a worker whose
//     lease expired and was taken over can no longer save an id, request a send or record an outcome;
//   * after a send request with an unknown outcome, a `draft` answer is not trusted until SEND_SETTLE_MS
//     has passed, so a slow Resend cannot trick a retry into a second request while the first is in flight.

const SEND_SETTLE_MS = 15 * 60 * 1000
const AUDIENCE_BUDGET_MS = 150_000

export interface SendReport {
  id: string
  editionKey: string
  outcome: 'sent' | 'already_sent' | 'blocked' | 'failed' | 'retry_later' | 'uncertain' | 'waiting' | 'paused' | 'superseded' | 'skipped_no_recipients'
  detail?: string
}

class Superseded extends Error {}

function dueWhere(now: Date): Prisma.NewsletterCampaignWhereInput {
  return {
    OR: [
      { status: 'SCHEDULED', scheduledFor: { lte: now } },
      { status: 'SENDING', leaseUntil: { lt: now } },
      { status: 'FAILED', nextAttemptAt: { lte: now }, sendAttempts: { lt: MAX_SEND_ATTEMPTS } },
    ],
  }
}

/** This worker's exclusive hold on the campaign: status SENDING at exactly the attempt it claimed. */
const fence = (c: NewsletterCampaign) => ({ id: c.id, status: 'SENDING' as const, sendAttempts: c.sendAttempts })

async function claim(id: string, now: Date): Promise<NewsletterCampaign | null> {
  try {
    const claimed = await prisma.newsletterCampaign.updateMany({
      where: { id, ...dueWhere(now) },
      data: { status: 'SENDING', leaseUntil: new Date(now.getTime() + SEND_LEASE_MS), sendAttempts: { increment: 1 }, nextAttemptAt: null },
    })
    return claimed.count === 1 ? prisma.newsletterCampaign.findUnique({ where: { id } }) : null
  } catch (error) {
    if (isUniqueViolation(error)) return null // another weekly is already in flight
    throw error
  }
}

async function fenced(c: NewsletterCampaign, data: Prisma.NewsletterCampaignUpdateManyMutationInput): Promise<void> {
  const updated = await prisma.newsletterCampaign.updateMany({ where: fence(c), data })
  if (updated.count !== 1) throw new Superseded()
}

async function finish(c: NewsletterCampaign, data: Prisma.NewsletterCampaignUpdateManyMutationInput, action: string, metadata: Record<string, unknown> = {}) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.newsletterCampaign.updateMany({ where: fence(c), data: { leaseUntil: null, ...data } })
    if (updated.count !== 1) throw new Superseded()
    await audit(tx, action, c, SYSTEM_ACTOR, metadata)
  })
}

async function markSent(c: NewsletterCampaign, broadcastId: string, now: Date, recipientCount: number | null, outcome: 'sent' | 'already_sent' = 'sent'): Promise<SendReport> {
  await finish(c, { status: 'SENT', sentAt: now, resendBroadcastId: broadcastId, nextAttemptAt: null, lastError: null, ...(recipientCount === null ? {} : { recipientCount }) }, 'sent', { broadcastId, recipientCount, attempt: c.sendAttempts, reconciled: outcome === 'already_sent' })
  return { id: c.id, editionKey: c.editionKey, outcome }
}

/** Set-once: refuses to store a different broadcast id than the one already recorded. */
async function saveBroadcastId(c: NewsletterCampaign, broadcastId: string) {
  const saved = await prisma.newsletterCampaign.updateMany({ where: { ...fence(c), resendBroadcastId: null }, data: { resendBroadcastId: broadcastId } })
  if (saved.count === 1) return
  const row = await prisma.newsletterCampaign.findUnique({ where: { id: c.id }, select: { resendBroadcastId: true, status: true, sendAttempts: true } })
  if (row?.resendBroadcastId === broadcastId && row.status === 'SENDING' && row.sendAttempts === c.sendAttempts) return
  throw new Superseded()
}

async function sendClaimed(c: NewsletterCampaign, provider: MarketingProvider, now: Date, options: SendOptions): Promise<SendReport> {
  let broadcastId = c.resendBroadcastId
  let stage = 'start'
  const report = (outcome: SendReport['outcome'], detail?: string): SendReport => ({ id: c.id, editionKey: c.editionKey, outcome, ...(detail ? { detail } : {}) })
  try {
    // The switch may have been flipped between the due-query and the claim.
    if (await isNewsletterPaused()) {
      await fenced(c, { status: 'SCHEDULED', scheduledFor: c.scheduledFor ?? now, leaseUntil: null, sendAttempts: { decrement: 1 } })
      return report('paused')
    }

    // 1. Reconcile with Resend before doing anything: did an earlier attempt create or even send it?
    stage = 'recover'
    if (!broadcastId && (c.sendAttempts > 1 || c.sendRequestedAt)) {
      const found = await provider.findBroadcastByName(broadcastName(c))
      if (found) {
        await saveBroadcastId(c, found.id)
        broadcastId = found.id
      }
    }
    if (broadcastId) {
      const existing = await provider.getBroadcast(broadcastId)
      if (existing.status !== 'draft') return await markSent(c, broadcastId, now, c.recipientCount, 'already_sent')
      if (c.sendRequestedAt && now.getTime() - c.sendRequestedAt.getTime() < SEND_SETTLE_MS) {
        // A send was requested and its outcome is unknown: give Resend time before trusting "draft".
        await fenced(c, { leaseUntil: new Date(c.sendRequestedAt.getTime() + SEND_SETTLE_MS) })
        return report('uncertain', 'waiting for Resend to settle the earlier send request')
      }
    }

    // 2. Fail-closed publication check against the approved snapshot.
    stage = 'publication_check'
    const content = readContent(c.articles)
    const problems = await verifySnapshotStillPublic(content.items, now, { fetchLinks: options.fetchLinks })
    const guard = problems.length
      ? problems.map((p) => `${p.title}: ${p.problem}`).join('\n')
      : c.kind === 'WEEKLY'
        ? await weeklyGapProblem(now, c.id)
        : await alertCapProblem(now, c.id)
    if (guard) {
      await finish(c, { status: 'BLOCKED', blockedReason: guard.slice(0, 4000) }, 'blocked', { problems: problems.length })
      return report('blocked', guard)
    }

    // 3. Audience: the whole segment provably matches the database, or the send waits.
    stage = 'audience'
    let audience
    try {
      audience = await prepareAudience(provider, { deadline: Date.now() + (options.audienceBudgetMs ?? AUDIENCE_BUDGET_MS) })
    } catch (error) {
      if (!(error instanceof AudienceNotReady)) throw error
      // Not a failure: no attempt is used up and the campaign stays scheduled for the next run.
      await fenced(c, { status: 'SCHEDULED', scheduledFor: c.scheduledFor ?? now, leaseUntil: null, sendAttempts: { decrement: 1 }, lastError: `waiting: ${error.message}`.slice(0, 1000) })
      return report('waiting', error.message)
    }
    await fenced(c, { leaseUntil: new Date(now.getTime() + SEND_LEASE_MS) }) // still ours; renew the lease
    const recipientCount = await prisma.subscriber.count({ where: { status: 'ACTIVE', ...(c.kind === 'WEEKLY' ? { weeklyDigest: true } : { specialAlerts: true }) } })
    if (recipientCount === 0) {
      await finish(c, { status: 'SKIPPED', blockedReason: 'No confirmed subscribers have opted in to this topic.' }, 'skipped_no_recipients')
      return report('skipped_no_recipients')
    }

    // 4. Create the broadcast once (id persisted immediately, set-once).
    stage = 'create'
    if (!broadcastId) {
      const rendered = renderCampaign(c)
      const created = await provider.createBroadcast({
        name: broadcastName(c),
        subject: c.subject,
        previewText: c.previewText ?? undefined,
        html: rendered.html,
        text: rendered.text,
        topic: c.kind === 'WEEKLY' ? 'weekly' : 'alerts',
      })
      await saveBroadcastId(c, created.id)
      broadcastId = created.id
    }

    // 5. Record the intent, then send only while Resend still reports a draft.
    stage = 'send'
    await fenced(c, { sendRequestedAt: now }) // same clock as the lease and settle checks
    const state = await provider.getBroadcast(broadcastId)
    if (state.status === 'draft') {
      try {
        await provider.sendBroadcast(broadcastId)
      } catch (error) {
        // A definite refusal may mean it already went (e.g. a concurrent request won): ask Resend.
        if (error instanceof ProviderError && !error.uncertain) {
          const after = await provider.getBroadcast(broadcastId).catch(() => null)
          if (after && after.status !== 'draft') return await markSent(c, broadcastId, now, recipientCount, 'already_sent')
        }
        throw error
      }
    }
    const sent = await markSent(c, broadcastId, now, recipientCount)
    return { ...sent, detail: `segment ${audience.segmentContacts} contacts, ${audience.strayContactsUnsubscribed} stray switched off, ${audience.audit.audited} topic checks` }
  } catch (error) {
    if (error instanceof Superseded) return report('superseded', 'another worker took over this campaign')
    const message = `${stage}: ${(error as Error).message}`.slice(0, 1000)
    const providerError = error instanceof ProviderError ? error : null
    try {
      if (providerError?.uncertain && (stage === 'create' || stage === 'send') && c.sendAttempts <= MAX_SEND_ATTEMPTS + 2) {
        // The request may have taken effect. Keep the lease; once it expires the next run reconciles with
        // Resend (stored id, or lookup by name) before doing anything else.
        await fenced(c, { lastError: message })
        return report('uncertain', message)
      }
      const retryable = providerError ? providerError.retryable : stage !== 'publication_check'
      const attempt = c.sendAttempts
      const next = retryable && attempt < MAX_SEND_ATTEMPTS ? new Date(now.getTime() + SEND_BACKOFF_MS[Math.min(attempt - 1, SEND_BACKOFF_MS.length - 1)]) : null
      await finish(c, { status: 'FAILED', lastError: message, nextAttemptAt: next }, next ? 'attempt_failed' : 'failed', { stage, attempt, retryAt: next?.toISOString() ?? null })
      return report(next ? 'retry_later' : 'failed', message)
    } catch (inner) {
      if (inner instanceof Superseded) return report('superseded', 'another worker took over this campaign')
      throw inner
    }
  }
}

export interface SendOptions {
  provider?: MarketingProvider
  fetchLinks?: boolean
  /** Time allowed for syncing and verifying the audience before a send waits for the next run. */
  audienceBudgetMs?: number
}

export interface RunReport {
  paused: boolean
  deliveryDisabled?: string
  results: SendReport[]
}

export async function runDueCampaigns(now = new Date(), options: SendOptions = {}): Promise<RunReport> {
  if (await isNewsletterPaused()) return { paused: true, results: [] }
  const resolution = options.provider ? { provider: options.provider } : getMarketingProvider()
  if (!resolution.provider) return { paused: false, deliveryDisabled: 'reason' in resolution ? resolution.reason : 'unavailable', results: [] }
  const fetchLinks = options.fetchLinks ?? (resolveDelivery().mode === 'resend' || process.env.NEWSLETTER_VERIFY_LINKS === '1')
  const due = await prisma.newsletterCampaign.findMany({ where: dueWhere(now), orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }], take: 5 })
  const results: SendReport[] = []
  for (const candidate of due) {
    const claimed = await claim(candidate.id, now)
    if (!claimed) continue
    results.push(await sendClaimed(claimed, resolution.provider, now, { ...options, fetchLinks }))
  }
  return { paused: false, results }
}

/** Tests only: drive one claimed campaign directly (used to replay a stale worker after a takeover). */
export const sendClaimedForTests = sendClaimed
