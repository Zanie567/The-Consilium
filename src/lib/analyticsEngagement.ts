import { prisma } from '@/lib/prisma'
export async function readingEngagement(since: Date) {
  const [summary, top, daily, qualifiedReaders] = await Promise.all([
    prisma.$queryRaw<
      {
        visits: bigint
        engaged: bigint
        five: bigint
        seconds: bigint
        readers: bigint
        returning: bigint
      }[]
    >`
 SELECT count(*) AS visits, count(*) FILTER (WHERE e."activeSeconds" >= 300) AS engaged,
 count(*) FILTER (WHERE e."activeSeconds" >= 300) AS five, COALESCE(sum(e."activeSeconds"),0) AS seconds,
 count(DISTINCT e."readerHash") AS readers, count(DISTINCT e."readerHash") FILTER (WHERE e."returning") AS "returning"
 FROM article_engagement_sessions e JOIN articles a ON a.id=e."articleId"
 WHERE e."startedAt" >= ${since} AND a.status='PUBLISHED' AND a."deletedAt" IS NULL`,
    prisma.$queryRaw<
      { id: string; title: string; visits: bigint; engaged: bigint; seconds: bigint }[]
    >`
 SELECT a.id,a.title,count(*) AS visits,count(*) FILTER(WHERE e."activeSeconds">=300) AS engaged,sum(e."activeSeconds") AS seconds
 FROM article_engagement_sessions e JOIN articles a ON a.id=e."articleId"
 WHERE e."startedAt">=${since} AND a.status='PUBLISHED' AND a."deletedAt" IS NULL
 GROUP BY a.id,a.title ORDER BY seconds DESC,a.id LIMIT 10`,
    prisma.$queryRaw<
      { day: string; visits: bigint; engaged: bigint; five: bigint; seconds: bigint }[]
    >`
 SELECT to_char(e."startedAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,count(*) AS visits,
 count(*) FILTER(WHERE e."activeSeconds">=300) AS engaged,count(*) FILTER(WHERE e."activeSeconds">=300) AS five,sum(e."activeSeconds") AS seconds
 FROM article_engagement_sessions e JOIN articles a ON a.id=e."articleId"
 WHERE e."startedAt">=${since} AND a.status='PUBLISHED' AND a."deletedAt" IS NULL
 GROUP BY day ORDER BY day LIMIT 91`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM (
        SELECT e."readerHash" FROM article_engagement_sessions e JOIN articles a ON a.id=e."articleId"
        WHERE e."startedAt">=${since} AND e."readerHash" IS NOT NULL AND a.status='PUBLISHED' AND a."deletedAt" IS NULL
        GROUP BY e."readerHash" HAVING sum(e."activeSeconds")>=300
      ) readers`,
  ])
  const s = summary[0]
  const visits = Number(s?.visits ?? 0),
    readers = Number(s?.readers ?? 0)
  return {
    visits,
    engagedReads: Number(s?.engaged ?? 0),
    fiveMinuteReaders: Number(qualifiedReaders[0]?.count ?? 0),
    fiveMinuteReads: Number(s?.five ?? 0),
    averageActiveSeconds: visits ? Math.round(Number(s.seconds) / visits) : 0,
    consentedReaders: readers,
    returningReaders: Number(s?.returning ?? 0),
    top: top.map((r) => ({
      ...r,
      visits: Number(r.visits),
      engaged: Number(r.engaged),
      seconds: Number(r.seconds),
    })),
    daily: daily.map((r) => ({
      ...r,
      visits: Number(r.visits),
      engaged: Number(r.engaged),
      five: Number(r.five),
      seconds: Number(r.seconds),
    })),
  }
}
export async function pruneReadingAnalytics(now = new Date()) {
  const rows = await prisma.articleEngagementSession.findMany({
    where: { startedAt: { lt: new Date(now.getTime() - 90 * 86400000) } },
    select: { id: true },
    orderBy: { startedAt: 'asc' },
    take: 5000,
  })
  return (
    await prisma.articleEngagementSession.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    })
  ).count
}

export async function consentedAudience(since: Date, until: Date) {
  const rows = await prisma.$queryRaw<{ readers: bigint; returning: bigint }[]>`
 SELECT count(DISTINCT e."readerHash") AS readers, count(DISTINCT e."readerHash") FILTER(WHERE e."returning") AS "returning"
 FROM article_engagement_sessions e JOIN articles a ON a.id=e."articleId"
 WHERE e."startedAt">=${since} AND e."startedAt"<${until} AND a.status='PUBLISHED' AND a."deletedAt" IS NULL`
  return { readers: Number(rows[0]?.readers ?? 0), returning: Number(rows[0]?.returning ?? 0) }
}
