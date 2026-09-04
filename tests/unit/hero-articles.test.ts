import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectHeroArticles, HERO_ROTATION_LIMIT } from '@/lib/heroArticles'
import { publishedArticleWhere, ARTICLES_CACHE_TAG } from '@/lib/articleQueries'
import { revalidateArticleLists } from '@/lib/revalidateArticles'

const updateTag = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ updateTag }))

/**
 * The homepage hero rotates through a small set of articles. These guard the
 * two properties that matter editorially: the set is derived, never listed —
 * publishing an article must change what the hero shows without anyone touching
 * this repository — and a deliberately featured article always leads it.
 */

interface Stub {
  id: string
  publishedAt: string
}

/** Newest first, exactly as the homepage's `publishedAt desc` query returns. */
const newestFirst = (...ids: string[]): Stub[] =>
  ids.map((id, i) => ({ id, publishedAt: `2026-09-${String(20 - i).padStart(2, '0')}` }))

const ids = (articles: { id: string }[]) => articles.map((a) => a.id)

describe('selectHeroArticles', () => {
  it('leads with the explicitly featured article', () => {
    const recent = newestFirst('d', 'c', 'b')
    const featured = { id: 'a', publishedAt: '2026-01-01' }
    expect(ids(selectHeroArticles(featured, recent))).toEqual(['a', 'd', 'c'])
  })

  it('keeps a featured article at the front even though it is the oldest', () => {
    const featured = { id: 'old-but-featured', publishedAt: '2020-01-01' }
    const recent = newestFirst('brand-new', 'yesterday')
    expect(ids(selectHeroArticles(featured, recent))[0]).toBe('old-but-featured')
  })

  it('falls back to newest-first when nothing is featured', () => {
    expect(ids(selectHeroArticles(null, newestFirst('d', 'c', 'b', 'a')))).toEqual(['d', 'c', 'b'])
  })

  it('never repeats the featured article, which the homepage query also returns', () => {
    const featured = { id: 'b', publishedAt: '2026-09-19' }
    const recent = newestFirst('a', 'b', 'c', 'd')
    const selected = ids(selectHeroArticles(featured, recent))
    expect(selected).toEqual(['b', 'a', 'c'])
    expect(new Set(selected).size).toBe(selected.length)
  })

  it('caps the rotation at HERO_ROTATION_LIMIT', () => {
    expect(HERO_ROTATION_LIMIT).toBe(3)
    const recent = newestFirst('a', 'b', 'c', 'd', 'e', 'f', 'g')
    expect(selectHeroArticles(null, recent)).toHaveLength(HERO_ROTATION_LIMIT)
  })

  it('degrades cleanly below the limit', () => {
    expect(selectHeroArticles(null, [])).toEqual([])
    expect(ids(selectHeroArticles(null, newestFirst('a')))).toEqual(['a'])
    expect(ids(selectHeroArticles(null, newestFirst('a', 'b')))).toEqual(['a', 'b'])
  })

  it('is deterministic — the same data always yields the same order', () => {
    const featured = { id: 'a', publishedAt: '2026-01-01' }
    const recent = newestFirst('d', 'c', 'b')
    const runs = Array.from({ length: 20 }, () => ids(selectHeroArticles(featured, recent)))
    expect(new Set(runs.map((r) => r.join(',')))).toHaveLength(1)
  })

  it('only ever returns articles it was given', () => {
    const featured = { id: 'a', publishedAt: '2026-01-01' }
    const recent = newestFirst('d', 'c', 'b')
    const supplied = new Set([featured.id, ...ids(recent)])
    for (const article of selectHeroArticles(featured, recent)) {
      expect(supplied.has(article.id)).toBe(true)
    }
  })
})

/**
 * The behaviour the editor actually depends on: publish something, and it is in
 * the hero on the next homepage refresh — no deploy, no code edit.
 */
describe('a newly published article joins the rotation on its own', () => {
  it('enters the candidate set and pushes the oldest out', () => {
    // Nothing is starred, so the homepage's getFeaturedArticle() falls back to
    // the newest published article — passed here as `featured`.
    const before = newestFirst('c', 'b', 'a')
    expect(ids(selectHeroArticles(before[0], before))).toEqual(['c', 'b', 'a'])

    // D is published. The same query now returns it at the head; no code
    // changed between these two calls.
    const after = newestFirst('d', 'c', 'b', 'a')
    const rotation = ids(selectHeroArticles(after[0], after))
    expect(rotation).toEqual(['d', 'c', 'b'])
    expect(rotation).toContain('d')
    expect(rotation).not.toContain('a')
  })

  it('does not displace a deliberately featured article', () => {
    const featured = { id: 'editor-s-pick', publishedAt: '2026-05-01' }
    const after = newestFirst('brand-new', 'c', 'b', 'a')
    const rotation = ids(selectHeroArticles(featured, after))
    // The newcomer joins the rotation, but only behind the editor's choice.
    expect(rotation).toEqual(['editor-s-pick', 'brand-new', 'c'])
  })

  it('drops an article the moment the query stops returning it', () => {
    const live = newestFirst('c', 'b', 'a')
    expect(ids(selectHeroArticles(live[0], live))).toContain('b')

    // B is unpublished or trashed: publishedArticleWhere no longer matches it,
    // so it is simply absent from the next query result.
    const afterUnpublish = live.filter((a) => a.id !== 'b')
    expect(ids(selectHeroArticles(afterUnpublish[0], afterUnpublish))).not.toContain('b')
  })
})

/**
 * The hero never runs its own query — it re-uses the homepage's. This pins the
 * filter those queries are built from, which is what actually keeps drafts,
 * scheduled pieces and trashed articles out of the rotation.
 */
describe('hero eligibility comes from the shared published filter', () => {
  it('admits only published, non-deleted, non-debate articles', () => {
    expect(publishedArticleWhere({ isDebate: false })).toEqual({
      status: 'PUBLISHED',
      deletedAt: null,
      isDebate: false,
    })
  })

  it('excludes every non-published status the schema defines', () => {
    const { status } = publishedArticleWhere({ isDebate: false })
    for (const excluded of ['DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'ARCHIVED', 'REJECTED']) {
      expect(status).not.toBe(excluded)
    }
  })
})

/**
 * The hero is only as fresh as the homepage's cached article queries, which are
 * tagged `articles`. Publishing, unpublishing, trashing or restoring an article
 * calls revalidateArticleLists, and that is what drops a newly published piece
 * into the rotation without a deploy — so the tag it expires is worth pinning.
 */
describe('publishing refreshes the hero', () => {
  beforeEach(() => updateTag.mockClear())

  it('expires the same cache tag the homepage queries are stored under', () => {
    revalidateArticleLists()
    expect(updateTag).toHaveBeenCalledWith(ARTICLES_CACHE_TAG)
  })

  it('never turns a revalidation hiccup into a failed publish', () => {
    updateTag.mockImplementationOnce(() => {
      throw new Error('cache unavailable')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => revalidateArticleLists()).not.toThrow()
    consoleError.mockRestore()
  })
})
