import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// Real authorization is covered by the live/browser RBAC suites. This case
// isolates reporting semantics while retaining actual SQL and owned fixtures.
vi.mock('@/lib/auth', () => ({ getVerifiedSessionUser: async () => ({ id: 'local-reporting-test', role: 'ADMIN' }) }))
import { GET } from '@/app/api/editorial/analytics/route'

describe('analytics selected-period reporting', () => {
  it('excludes historical debate votes from the selected-period activity ratio', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, role: 'WRITER' } })
    const ids: string[] = []
    let debateId = ''
    try {
      for (const title of ['For', 'Against']) {
        const article = await prisma.article.create({ data: { title, slug: randomUUID(), content: 'Body', authorId: user.id, status: 'PUBLISHED', publishedAt: new Date() } })
        ids.push(article.id)
      }
      const debate = await prisma.debate.create({ data: { title: randomUUID(), forArticleId: ids[0], againstArticleId: ids[1] } })
      debateId = debate.id
      await prisma.debateVote.createMany({ data: [
        { debateId, side: 'FOR', anonymousId: randomUUID(), createdAt: new Date(Date.now() - 8 * 86400000) },
        { debateId, side: 'FOR', anonymousId: randomUUID(), createdAt: new Date(Date.now() - 31 * 86400000) },
        { debateId, side: 'AGAINST', anonymousId: randomUUID(), createdAt: new Date(Date.now() - 3600000) },
      ] })
      const response = await GET(new NextRequest('http://localhost/api/editorial/analytics?tab=engagement&period=24h'))
      expect(response.status).toBe(200)
      const report = await response.json()
      const row = report.debateParticipation.find((item: { title: string }) => item.title === debate.title)
      expect(row).toMatchObject({ totalVotes: 1, forPct: 0, againstPct: 100 })
    } finally {
      if (debateId) await prisma.debate.delete({ where: { id: debateId } })
      await prisma.article.deleteMany({ where: { id: { in: ids } } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })
})
