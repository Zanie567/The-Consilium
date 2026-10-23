import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { purgeExpiredTrash } from '@/lib/trashPurge'
import * as imageStorage from '@/lib/articleImageStorage'

vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), articlePublishedEmail: vi.fn(() => ({ subject: 's', html: 'h' })) }))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements: vi.fn() }))

const ids: string[] = []
const urls: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  const gone = ids.splice(0)
  await prisma.auditLog.deleteMany({ where: { targetId: { in: gone } } })
  await prisma.article.deleteMany({ where: { id: { in: gone } } })
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
// Publishing and permanent trash removal are separate jobs (src/lib/trashPurge.ts,
// POST /api/cron/purge-trash): publishing never deletes, and each purge is audited.
describe('scheduled publication uses current state; trash expiry preserves managed cleanup', () => {
  it('publishes a genuinely due article over HTTP once, with captured email and a public page', async () => {
    const row = await article()
    const invoke = () => fetch(`${process.env.BASE_URL}/api/publish-scheduled`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    const first = await invoke()
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body.articles).toContainEqual(expect.objectContaining({ id: row.id }))
    expect(body.warnings).toEqual([])
    const second = await invoke()
    expect(second.status).toBe(200)
    expect((await second.json()).articles).not.toContainEqual(expect.objectContaining({ id: row.id }))
    const stored = await prisma.article.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.status).toBe('PUBLISHED')
    expect(stored.scheduledAt).toBeNull()
    expect(stored.publishedAt).not.toBeNull()
    expect(await prisma.notification.count({ where: { articleId: row.id, type: 'published' } })).toBe(1)
    const messages = readFileSync(process.env.EMAIL_CAPTURE_FILE!, 'utf8').trim().split('\n')
      .filter(Boolean).map(line => JSON.parse(line) as { html: string })
    expect(messages.filter(message => message.html.includes(`/articles/${row.slug}`))).toHaveLength(1)
    const page = await fetch(`${process.env.BASE_URL}/articles/${row.slug}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(row.title)
  })
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
    const result = await purgeExpiredTrash()
    expect(result.articleIds).toContain(row.id)
    expect(await prisma.article.findUnique({ where: { id: row.id } })).toBeNull()
    expect((await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince).not.toBeNull()
    // every permanent deletion is audited, atomically with the delete
    expect(await prisma.auditLog.findFirst({ where: { targetId: row.id, action: 'ARTICLE_HARD_DELETED' } }))
      .toMatchObject({ performedBy: 'system:trash-purge', targetType: 'article' })
  })
  it('publishing never purges: a due publish run leaves an expired trashed article in place', async () => {
    const trashed = await article()
    await prisma.article.update({ where: { id: trashed.id }, data: {
      status: 'DRAFT', scheduledAt: null, deletedAt: new Date(Date.now() - 31 * 86400000),
    } })
    await publishScheduledArticles()
    expect(await prisma.article.findUnique({ where: { id: trashed.id } })).not.toBeNull()
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
    const result = await purgeExpiredTrash()
    expect(result.articleIds).not.toContain(row.id)
    expect(result.errors.map((e) => e.articleId)).toContain(row.id) // reported, never silent
    expect(await prisma.article.findUnique({ where: { id: row.id } })).not.toBeNull()
    expect((await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince).toBeNull()
    expect(await prisma.auditLog.count({ where: { targetId: row.id, action: 'ARTICLE_HARD_DELETED' } })).toBe(0)
  })
  it('does not purge an article restored after the expiry-list snapshot', async () => {
    const row = await article()
    const expired = await prisma.article.update({ where: { id: row.id }, data: {
      deletedAt: new Date(Date.now() - 31 * 86400000),
    } })
    await prisma.article.update({ where: { id: row.id }, data: { deletedAt: null, status: 'DRAFT' } })
    vi.spyOn(prisma.article, 'findMany').mockResolvedValueOnce([expired])
    const result = await purgeExpiredTrash()
    expect(result.count).toBe(0)
    expect(await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ deletedAt: null, status: 'DRAFT' })
  })
})
