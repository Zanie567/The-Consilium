import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, (...args: string[]) => Promise<unknown>>,
  article: {findFirst:vi.fn(),findMany:vi.fn()},
  category: {findMany:vi.fn()}, articleView: {groupBy:vi.fn()},
  articleTag: {findMany:vi.fn()},
}))
vi.mock('@/lib/prisma', () => ({prisma:mocks}))
vi.mock('@/lib/auth', () => ({authOptions:{}}))
vi.mock('next/cache', () => ({unstable_cache:(fn:(...args:string[])=>Promise<unknown>, keys:string[]) => {
  mocks.queries[keys[0]]=fn
  return fn
}}))
import '@/app/(home)/page'
beforeEach(() => vi.clearAllMocks())
it.each([
  ['home-featured',()=>mocks.article.findFirst],
  ['home-grid',()=>mocks.article.findMany],
  ['home-categories',()=>mocks.category.findMany],
  ['home-most-read',()=>mocks.articleView.groupBy],
  ['home-trending-tags',()=>mocks.articleTag.findMany],
] as const)('%s never turns a rejected database query into a cacheable empty value', async (name, query) => {
  const outage = new Error('database unavailable')
  query().mockRejectedValueOnce(outage)
  await expect(mocks.queries[name]()).rejects.toBe(outage)
})
it('a genuine empty article feed still resolves successfully', async () => {
  mocks.article.findMany.mockResolvedValueOnce([])
  await expect(mocks.queries['home-grid']()).resolves.toEqual([])
})
