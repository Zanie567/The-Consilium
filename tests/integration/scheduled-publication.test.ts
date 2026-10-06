import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import * as imageStorage from '@/lib/articleImageStorage'

vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), articlePublishedEmail: vi.fn(() => ({ subject: 's', html: 'h' })) }))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements: vi.fn() }))

const ids: string[] = []
const urls: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await prisma.article.deleteMany({ where: { id: { in: ids.splice(0) } } })
  await prisma.articleImageAsset.deleteMany({ where: { url: { in: urls.splice(0) } } })
})
async function article() {
  const writer = await prisma.user.findUniqueOrThrow({ where: { email: 'writer@theconsilium.com' } })
  const row = await prisma.article.create({ data: {
    title: 'Final integration scheduler fixture', slug: `scheduler-${randomUUID()}`,
    content: 'Scheduled content', authorId: writer.id, status: 'SCHEDULED',
    scheduledAt: new Date(Date.now() - 60000),
  }, include: { author: true } })
  ids.push(row.id)
  return row
}
describe('scheduled publication uses current state and preserves managed cleanup', () => {
  it('publishes a due article once with one in-app notification', async () => {
    const row = await article()
    await publishScheduledArticles()
    await publishScheduledArticles()
    expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PUBLISHED')
    expect(await prisma.notification.count({ where: { articleId: row.id, type: 'published' } })).toBe(1)
  })
  it('does not publish an article trashed after the due-list snapshot', async () => {
    const row = await article()
    await prisma.article.update({ where: { id: row.id }, data: { deletedAt: new Date() } })
    vi.spyOn(prisma.article, 'findMany').mockResolvedValueOnce([row])
    const result = await publishScheduledArticles()
    expect(result.skipped.map(article => article.id)).toContain(row.id)
    expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SCHEDULED')
    expect(await prisma.notification.count({ where: { articleId: row.id, type: 'published' } })).toBe(0)
  })
  it('queues an unreferenced managed image after automatic trash expiry', async () => {
    const row = await article()
    const path = `${row.authorId}/${randomUUID()}.png`
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/article-images/${path}`
    urls.push(url)
    await prisma.articleImageAsset.create({ data: { url, path, uploaderId: row.authorId, unusedSince: null } })
    await prisma.article.update({ where: { id: row.id }, data: {
      deletedAt: new Date(Date.now() - 31 * 86400000),
      content: JSON.stringify({ type: 'doc', content: [{ type: 'figure', attrs: { src: url, alt: 'Chart' } }] }),
    } })
    await publishScheduledArticles()
    expect(await prisma.article.findUnique({ where: { id: row.id } })).toBeNull()
    expect((await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince).not.toBeNull()
  })
  it('rolls back trash expiry when cleanup eligibility cannot be recorded', async () => {
    const row = await article()
    const path = `${row.authorId}/${randomUUID()}.png`
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/article-images/${path}`
    urls.push(url)
    await prisma.articleImageAsset.create({ data: { url, path, uploaderId: row.authorId, unusedSince: null } })
    await prisma.article.update({ where: { id: row.id }, data: {
      deletedAt: new Date(Date.now() - 31 * 86400000),
      content: JSON.stringify({ type: 'figure', attrs: { src: url } }),
    } })
    vi.spyOn(imageStorage, 'queueDeletedArticleImages').mockRejectedValueOnce(new Error('Cleanup DB unavailable'))
    await publishScheduledArticles()
    expect(await prisma.article.findUnique({ where: { id: row.id } })).not.toBeNull()
    expect((await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince).toBeNull()
  })
  it('does not purge an article restored after the expiry-list snapshot', async () => {
    const row = await article()
    const expired = await prisma.article.update({ where: { id: row.id }, data: {
      deletedAt: new Date(Date.now() - 31 * 86400000),
    } })
    await prisma.article.update({ where: { id: row.id }, data: { deletedAt: null, status: 'DRAFT' } })
    vi.spyOn(prisma.article, 'findMany').mockResolvedValueOnce([]).mockResolvedValueOnce([expired])
    const result = await publishScheduledArticles()
    expect(result.purged).toBe(0)
    expect(await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ deletedAt: null, status: 'DRAFT' })
  })
})
