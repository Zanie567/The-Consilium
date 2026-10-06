import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { collectAnalytics, referrerOrigin } from '@/lib/analyticsCollector'
import { readingEngagement, pruneReadingAnalytics } from '@/lib/analyticsEngagement'
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'local' }))
import { POST } from '@/app/api/analytics/track/route'
let articleId: string, draftId: string, userId: string
const sessionId = randomUUID(),
  visitId = randomUUID(),
  readerId = randomUUID(),
  now = new Date()
beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, role: 'WRITER' } })
  ).id
  articleId = (
    await prisma.article.create({
      data: {
        title: 'Analytics fixture',
        slug: randomUUID(),
        content: 'Body',
        authorId: userId,
        status: 'PUBLISHED',
        publishedAt: now,
      },
    })
  ).id
  draftId = (
    await prisma.article.create({
      data: { title: 'Draft analytics', slug: randomUUID(), content: 'Draft', authorId: userId },
    })
  ).id
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { id: { in: [articleId, draftId] } } })
  await prisma.user.delete({ where: { id: userId } })
})
describe('canonical analytics persistence', () => {
  it('deduplicates concurrent views and strips referrer paths', async () => {
    const editorialRevision = (await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).updatedAt
    await Promise.all(
      Array.from({ length: 6 }, () =>
        collectAnalytics(
          {
            articleId,
            sessionId,
            visitId,
            readerId,
            consent: true,
            activeSeconds: 999,
            referrer: 'https://example.test/private?token=secret',
          },
          now
        )
      )
    )
    expect(await prisma.articleView.count({ where: { articleId } })).toBe(1)
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).viewCount).toBe(1)
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).updatedAt).toEqual(editorialRevision)
    expect((await prisma.articleView.findFirstOrThrow({ where: { articleId } })).referrer).toBe(
      'https://example.test'
    )
    expect(
      (await prisma.articleEngagementSession.findUniqueOrThrow({ where: { id: visitId } }))
        .activeSeconds
    ).toBe(0)
  })
  it('persists monotonic elapsed-bounded time and threshold metrics', async () => {
    await collectAnalytics(
      { articleId, sessionId, visitId, readerId, consent: true, activeSeconds: 300 },
      new Date(now.getTime() + 300000)
    )
    await collectAnalytics(
      { articleId, sessionId, visitId, readerId, consent: true, activeSeconds: 10 },
      new Date(now.getTime() + 310000)
    )
    expect(
      (await prisma.articleEngagementSession.findUniqueOrThrow({ where: { id: visitId } }))
        .activeSeconds
    ).toBe(300)
    const metrics = await readingEngagement(new Date(now.getTime() - 1000))
    expect(metrics.top.some((r) => r.id === articleId && r.engaged === 1)).toBe(true)
    expect(metrics.fiveMinuteReads).toBeGreaterThanOrEqual(1)
    expect(metrics.daily.length).toBeGreaterThanOrEqual(1)
  })
  it('recomputes a derived engagement score without changing the editorial revision', async () => {
    const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } })
    // Limit this real cron execution to our owned fixture; score computation
    // and the database write remain real.
    const selection = vi.spyOn(prisma.article, 'findMany').mockResolvedValueOnce([article])
    vi.stubEnv('CRON_SECRET', 'local-engagement-regression-only')
    try {
      const { POST: updateScores } = await import('@/app/api/cron/update-engagement-scores/route')
      const response = await updateScores(new Request('http://localhost/api/cron/update-engagement-scores', {
        method: 'POST', headers: { Authorization: 'Bearer local-engagement-regression-only' },
      }))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ processed: 1, errors: 0 })
      const scored = await prisma.article.findUniqueOrThrow({ where: { id: articleId } })
      expect(scored.engagementScore).toBe(0)
      expect(scored.updatedAt).toEqual(article.updatedAt)
    } finally {
      selection.mockRestore()
      vi.unstubAllEnvs()
    }
  })
  it('counts returning only on an earlier UTC day with consent; decline unlinks current visit', async () => {
    const nextVisit = randomUUID()
    await collectAnalytics(
      { articleId, sessionId: randomUUID(), visitId: nextVisit, readerId, consent: true },
      new Date(now.getTime() + 86400000)
    )
    expect(
      (await prisma.articleEngagementSession.findUniqueOrThrow({ where: { id: nextVisit } }))
        .returning
    ).toBe(true)
    await collectAnalytics(
      { articleId, sessionId, visitId: nextVisit, consent: false },
      new Date(now.getTime() + 86401000)
    )
    const row = await prisma.articleEngagementSession.findUniqueOrThrow({
      where: { id: nextVisit },
    })
    expect(row.readerHash).toBeNull()
    expect(row.returning).toBe(false)
  })
  it('drops drafts, invalid ids and reused visits on another article', async () => {
    await collectAnalytics({ articleId: draftId, sessionId, visitId: randomUUID() }, now)
    expect(await prisma.articleView.count({ where: { articleId: draftId } })).toBe(0)
    const countBefore = await prisma.articleView.count({ where: { articleId } })
    await collectAnalytics({ articleId, sessionId: 'x'.repeat(200) }, now)
    expect(await prisma.articleView.count({ where: { articleId } })).toBe(countBefore)
  })
  it('counts consented readers accumulating five minutes across shorter visits without qualifying each visit', async () => {
    const readerId = randomUUID()
    for (let i = 0; i < 2; i++) {
      const visitId = randomUUID(),
        start = new Date(now.getTime() + i * 200000)
      await collectAnalytics({ articleId, sessionId, visitId, readerId, consent: true }, start)
      await collectAnalytics(
        { articleId, sessionId, visitId, readerId, consent: true, activeSeconds: 180 },
        new Date(start.getTime() + 180000)
      )
      expect(
        (await prisma.articleEngagementSession.findUniqueOrThrow({ where: { id: visitId } }))
          .engagedAt
      ).toBeNull()
    }
    expect(
      (await readingEngagement(new Date(now.getTime() - 1000))).fiveMinuteReaders
    ).toBeGreaterThanOrEqual(2)
  })
  it('prunes stale engagement records in a bounded batch', async () => {
    const id = randomUUID()
    await prisma.articleEngagementSession.create({
      data: { id, articleId, startedAt: new Date(now.getTime() - 91 * 86400000) },
    })
    expect(await pruneReadingAnalytics(now)).toBeGreaterThanOrEqual(1)
    expect(await prisma.articleEngagementSession.findUnique({ where: { id } })).toBeNull()
  })
  it('returns ok on analytics database failure without leaking errors', async () => {
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('private'))
    const response = await POST(
      new NextRequest('http://localhost/api/analytics/track', {
        method: 'POST',
        body: JSON.stringify({ articleId, sessionId }),
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    spy.mockRestore()
  })
  it('drops bots, malformed and oversized events safely', async () => {
    for (const [body, ua] of [
      ['bad', 'reader'],
      [JSON.stringify({ articleId, sessionId }), 'Googlebot'],
      ['x'.repeat(5000), 'reader'],
    ])
      expect(
        (
          await POST(
            new NextRequest('http://localhost/api/analytics/track', {
              method: 'POST',
              headers: { 'user-agent': ua },
              body,
            })
          )
        ).status
      ).toBe(200)
    expect(referrerOrigin('javascript:alert(1)')).toBeNull()
  })
})
