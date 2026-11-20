import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPublicTag = vi.hoisted(() => vi.fn())
vi.mock('@/lib/publicPageData', () => ({ getPublicTag }))

import { generateMetadata } from '@/app/tag/[slug]/page'

const params = Promise.resolve({ slug: 'inflation' })
const topic = (articles: number) => ({
  slug: 'inflation',
  name: 'Inflation',
  mergedInto: null,
  articles: Array.from({ length: articles }, (_, i) => ({ articleId: `article-${i}` })),
})

beforeEach(() => vi.clearAllMocks())

describe('tag search indexability', () => {
  it('noindexes a one-article topic without blocking readers or crawler link-following', async () => {
    getPublicTag.mockResolvedValue(topic(1))
    const metadata = await generateMetadata({ params })
    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.alternates?.canonical).toBe('/tag/inflation')
  })

  it('allows indexing when the topic grows to two published articles', async () => {
    getPublicTag.mockResolvedValue(topic(2))
    const metadata = await generateMetadata({ params })
    expect(metadata.robots).toBeUndefined()
    expect(metadata.alternates?.canonical).toBe('/tag/inflation')
  })
})
