import { createHash, createHmac } from 'node:crypto'
import { prisma } from '@/lib/prisma'
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
  const bucket = Math.floor(now.getTime() / 1800000)
  const hash = createHash('sha256').update(`${sessionId}:${key}:${bucket}`).digest('hex')
  const referrer = referrerOrigin(body.referrer)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`view:${hash}`}))`
    if (typeof articleId !== 'string') {
      if (!(await tx.siteView.findFirst({ where: { sessionHash: hash }, select: { id: true } })))
        await tx.siteView.create({ data: { sessionHash: hash, referrer, pagePath: key } })
      return
    }
    if (
      !(await tx.article.findFirst({
        where: { id: articleId, status: 'PUBLISHED', deletedAt: null },
        select: { id: true },
      }))
    )
      return
    if (!(await tx.articleView.findFirst({ where: { sessionHash: hash }, select: { id: true } }))) {
      await tx.articleView.create({ data: { articleId, sessionHash: hash, referrer } })
      // Telemetry must not advance the editorial revision/dateModified or
      // invalidate an editor's open document. Increment atomically without
      // Prisma's automatic @updatedAt write.
      await tx.$executeRaw`UPDATE articles SET "viewCount" = "viewCount" + 1 WHERE id = ${articleId}`
    }
    if (typeof visitId !== 'string' || !uuid.test(visitId)) return
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`visit:${visitId}`}))`
    let visit = await tx.articleEngagementSession.findUnique({ where: { id: visitId } })
    if (visit && visit.articleId !== articleId) return
    const readerHash =
      body.consent === true &&
      typeof readerId === 'string' &&
      uuid.test(readerId) &&
      process.env.NEXTAUTH_SECRET
        ? createHmac('sha256', process.env.NEXTAUTH_SECRET)
            .update(`reader:${readerId}`)
            .digest('hex')
        : null
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
  })
}
