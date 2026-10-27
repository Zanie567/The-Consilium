import { createHash, createHmac } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function referrerOrigin(raw: unknown): string | null {
  try {
    const u = new URL(typeof raw === 'string' ? raw : '')
    return ['https:', 'http:'].includes(u.protocol) ? u.origin : null
  } catch {
    return null
  }
}
export async function collectAnalytics(body: Record<string, unknown>, now = new Date()) {
  const { sessionId, articleId, visitId, readerId } = body
  if (
    articleId !== undefined &&
    (typeof articleId !== 'string' || !articleId || articleId.length > 100)
  )
    return
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128) return
  const key =
    typeof articleId === 'string' && articleId.length <= 100
      ? articleId
      : typeof body.pagePath === 'string'
        ? body.pagePath.slice(0, 500).split('?')[0]
        : '/'
  // A consented reader keeps a pseudonymous id for 90 days; nothing identifies a reader
  // who has not consented (the session id is per page load, never stored).
  const readerHash =
    body.consent === true &&
    typeof readerId === 'string' &&
    uuid.test(readerId) &&
    process.env.NEXTAUTH_SECRET
      ? createHmac('sha256', process.env.NEXTAUTH_SECRET)
          .update(`reader:${readerId}`)
          .digest('hex')
      : null
  // One view per reader, page and half-hour. With consent, a refresh or a second tab is the
  // same reader; without it each page load is its own session, so a refresh counts again.
  // Deliberately not keyed on the IP address: readers behind one university NAT are distinct.
  const viewer = readerHash ? `reader:${readerHash}` : sessionId
  const bucket = Math.floor(now.getTime() / 1800000)
  const hash = createHash('sha256').update(`${viewer}:${key}:${bucket}`).digest('hex')

  const entryKind = body.entryKind === 'entry' || body.entryKind === 'internal'
    ? body.entryKind : null
  const label = (value: unknown) =>
    typeof value === 'string' && value.length <= 64 && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)
      ? value : null
  const source = entryKind === 'entry' ? label(body.campaignSource) : null
  const medium = entryKind === 'entry' ? label(body.campaignMedium) : null
  const campaign = entryKind === 'entry' ? label(body.campaignName) : null
  const campaignFields = source && medium && campaign ? {
    campaignSource: source,
    campaignMedium: medium,
    campaignName: campaign,
    campaignContent: label(body.campaignContent),
  } : {}
  // A navigated page does not get another external landing referrer.
  // Legacy clients without entryKind preserve their old attribution behaviour.
  const referrer = entryKind === 'internal' ? null : referrerOrigin(body.referrer)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`view:${hash}`}))`
    if (typeof articleId !== 'string') {
      if (!(await tx.siteView.findFirst({ where: { sessionHash: hash }, select: { id: true } })))
        await tx.siteView.create({ data: { sessionHash: hash, referrer, pagePath: key, entryKind, ...campaignFields } })
      return
    }
    if (
      !(await tx.article.findFirst({
        where: publishedArticleWhere({ id: articleId }),
        select: { id: true },
      }))
    )
      return
    const validVisit = typeof visitId === 'string' && uuid.test(visitId)
    // Lock order is always view, then visit, so concurrent events cannot deadlock.
    if (validVisit) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`visit:${visitId}`}))`
    let visit = validVisit ? await tx.articleEngagementSession.findUnique({ where: { id: visitId } }) : null
    // A heartbeat from a visit already recorded on this article is the same reading, even
    // when it crosses into the next half-hour or the reader's consent changed meanwhile.
    const continuingVisit = visit?.articleId === articleId
    const newView =
      !continuingVisit &&
      !(await tx.articleView.findFirst({ where: { sessionHash: hash }, select: { id: true } }))
    if (newView) {
      await tx.articleView.create({ data: { articleId, sessionHash: hash, referrer, entryKind, ...campaignFields } })
    }
    const incrementViewCount = async () => {
      if (!newView) return
      // Telemetry must not advance the editorial revision/dateModified or
      // invalidate an editor's open document. Increment atomically without
      // Prisma's automatic @updatedAt write. Do this LAST so first visitors to
      // the same article don't hold its row lock through engagement queries.
      await tx.$executeRaw`UPDATE articles SET "viewCount" = "viewCount" + 1 WHERE id = ${articleId}`
    }
    if (!validVisit) return incrementViewCount()
    if (visit && visit.articleId !== articleId) return incrementViewCount()
    if (!visit) {
      const startOfDay = new Date(now)
      startOfDay.setUTCHours(0, 0, 0, 0)
      const returning = readerHash
        ? Boolean(
            await tx.articleEngagementSession.findFirst({
              where: {
                readerHash,
                startedAt: { gte: new Date(now.getTime() - 90 * 86400000), lt: startOfDay },
              },
              select: { id: true },
            })
          )
        : false
      visit = await tx.articleEngagementSession.create({
        data: { id: visitId, articleId, startedAt: now, lastSeenAt: now, readerHash, returning },
      })
    }
    if (readerHash && visit.readerHash !== readerHash) {
      const startOfDay = new Date(now)
      startOfDay.setUTCHours(0, 0, 0, 0)
      const returning = Boolean(
        await tx.articleEngagementSession.findFirst({
          where: {
            readerHash,
            startedAt: { gte: new Date(now.getTime() - 90 * 86400000), lt: startOfDay },
          },
          select: { id: true },
        })
      )
      await tx.articleEngagementSession.update({
        where: { id: visitId },
        data: { readerHash, returning },
      })
    }
    const requested =
      typeof body.activeSeconds === 'number' && Number.isFinite(body.activeSeconds)
        ? Math.floor(body.activeSeconds)
        : 0
    const elapsed = Math.max(0, Math.ceil((now.getTime() - visit.lastSeenAt.getTime()) / 1000))
    const cumulativeLimit = Math.max(
      visit.activeSeconds,
      Math.floor((now.getTime() - visit.startedAt.getTime()) / 1000)
    )
    const seconds = Math.min(
      cumulativeLimit,
      visit.activeSeconds +
        Math.min(7200 - visit.activeSeconds, Math.max(0, requested - visit.activeSeconds), elapsed)
    )
    await tx.articleEngagementSession.update({
      where: { id: visitId },
      data: {
        activeSeconds: seconds,
        lastSeenAt: now > visit.lastSeenAt ? now : visit.lastSeenAt,
        engagedAt: visit.engagedAt ?? (seconds >= 300 ? now : null),
        ...(!readerHash ? { readerHash: null, returning: false } : {}),
      },
    })
    await incrementViewCount()
  })
}
