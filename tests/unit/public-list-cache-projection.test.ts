import { beforeEach, expect, it, vi } from 'vitest'
import { SENSITIVE_USER_FIELDS } from '@/lib/publicUser'

// The homepage grid/hero and category lists are stored in the shared Next data cache.
// What goes into that cache must be card-sized and public: no article body, no author
// account (email, moderation and security columns) and no editorial columns.
const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, (...args: string[]) => Promise<unknown>>,
  article: { findFirst: vi.fn(), findMany: vi.fn() },
  category: { findMany: vi.fn(), findUnique: vi.fn() },
  articleView: { groupBy: vi.fn() },
  articleTag: { findMany: vi.fn() },
  siteSetting: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: string[]) => Promise<unknown>, keys: string[]) => {
    mocks.queries[keys[0]] = fn
    return fn
  },
}))
import '@/app/(home)/page'
import '@/app/category/[slug]/page'

const body = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: Array(400).fill('word').join(' ') }] }],
})
// What Prisma returns for the card select. Extra columns would only appear if the query
// asked for them, which the assertions on the query arguments rule out.
const row = {
  id: 'a1', slug: 'a-1', title: 'A story', excerpt: 'Lead', coverImage: '/c.png',
  publishedAt: new Date('2026-10-20T10:00:00Z'), content: body,
  author: { name: 'Writer' }, category: { name: 'News', slug: 'news' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.article.findMany.mockResolvedValue([row])
})

it.each([
  ['home-grid', () => mocks.queries['home-grid']()],
  ['category-articles', () => mocks.queries['category-articles']('category-1')],
] as const)('%s selects card columns only and caches no body', async (_name, load) => {
  const cached = (await load()) as Record<string, unknown>[]
  const args = mocks.article.findMany.mock.calls[0][0]
  expect(args.include).toBeUndefined()
  expect(args.select.author).toEqual({ select: { name: true } })
  expect(args.select.category).toEqual({ select: { name: true, slug: true } })
  for (const editorial of ['editorNote', 'editorialNotes', 'commendation', 'engagementScore', 'scheduledAt', 'deletedAt', 'hiddenByDebateAt']) {
    expect(args.select).not.toHaveProperty(editorial)
  }
  for (const field of SENSITIVE_USER_FIELDS) expect(args.select.author.select).not.toHaveProperty(field)

  expect(cached).toEqual([{
    id: 'a1', slug: 'a-1', title: 'A story', excerpt: 'Lead', coverImage: '/c.png',
    publishedAt: row.publishedAt, author: { name: 'Writer' }, category: { name: 'News', slug: 'news' },
    readTime: '2 min read',
  }])
  expect(cached[0]).not.toHaveProperty('content')
})
