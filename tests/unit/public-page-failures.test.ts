import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({article:{findFirst:vi.fn(),findUnique:vi.fn()}, articleSlugRedirect:{findFirst:vi.fn()}, category:{findUnique:vi.fn()}}))
const notFound = vi.hoisted(() => vi.fn(() => { throw Error('NOT_FOUND') }))
vi.mock('@/lib/prisma', () => ({prisma:db}))
vi.mock('next/navigation', () => ({notFound,permanentRedirect:vi.fn()}))
vi.mock('next-auth', () => ({getServerSession:vi.fn().mockResolvedValue(null)}))
vi.mock('@/lib/auth', () => ({authOptions:{}}))
vi.mock('next/cache', () => ({unstable_cache:(fn:unknown)=>fn}))
import ArticlePage, {generateMetadata as articleMetadata} from '@/app/articles/[slug]/page'
import CategoryPage, {generateMetadata as categoryMetadata} from '@/app/category/[slug]/page'
beforeEach(() => {vi.clearAllMocks();db.articleSlugRedirect.findFirst.mockResolvedValue(null);db.article.findFirst.mockResolvedValue(null);db.article.findUnique.mockResolvedValue(null);db.category.findUnique.mockResolvedValue(null)})
const props = {params:Promise.resolve({slug:'public-fixture'})}
it('article database outages propagate to recovery, never notFound (including metadata)', async () => {
  const outage = new Error('database unavailable')
  db.article.findFirst.mockRejectedValue(outage)
  await expect(ArticlePage(props)).rejects.toBe(outage)
  await expect(articleMetadata(props)).rejects.toBe(outage)
  expect(notFound).not.toHaveBeenCalled()
})
it('category database outages propagate to recovery, never notFound (including metadata)', async () => {
  const outage = new Error('database unavailable')
  db.category.findUnique.mockRejectedValue(outage)
  await expect(CategoryPage(props)).rejects.toBe(outage)
  await expect(categoryMetadata(props)).rejects.toBe(outage)
  expect(notFound).not.toHaveBeenCalled()
})
it('genuinely missing articles and categories still return notFound', async () => {
  await expect(ArticlePage(props)).rejects.toThrow('NOT_FOUND')
  await expect(CategoryPage(props)).rejects.toThrow('NOT_FOUND')
  expect(notFound).toHaveBeenCalledTimes(2)
})
it('failed legacy URL lookup does not become a false 404', async () => {
  const outage = new Error('database unavailable')
  db.article.findUnique.mockRejectedValue(outage)
  await expect(ArticlePage(props)).rejects.toBe(outage)
  expect(notFound).not.toHaveBeenCalled()
})
