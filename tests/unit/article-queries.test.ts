import { describe, it, expect } from 'vitest'
import {
  PUBLISHED_ARTICLE_WHERE,
  publishedArticleWhere,
  ARTICLES_CACHE_TAG,
  ARTICLES_REVALIDATE_SECONDS,
} from '@/lib/articleQueries'

/**
 * Guards Priority 1: the canonical "publicly visible" filter must select every
 * PUBLISHED, non-deleted article — and must NOT silently exclude debate
 * articles, which was the launch-blocker bug (category pages hid 6 of 7 Opinion
 * pieces via `isDebate: false`).
 */
describe('publishedArticleWhere', () => {
  it('selects PUBLISHED and not soft-deleted', () => {
    const where = publishedArticleWhere()
    expect(where.status).toBe('PUBLISHED')
    expect(where.deletedAt).toBeNull()
  })

  it('does NOT constrain isDebate — debate articles are included by default', () => {
    const where = publishedArticleWhere()
    expect('isDebate' in where).toBe(false)
  })

  it('does not leak draft/archived/scheduled statuses', () => {
    const where = publishedArticleWhere()
    expect(where.status).not.toBe('DRAFT')
    expect(where.status).not.toBe('ARCHIVED')
    expect(where.status).not.toBe('SCHEDULED')
  })

  it('merges extra constraints (e.g. categoryId) without dropping the base filter', () => {
    const where = publishedArticleWhere({ categoryId: 'cat_123' })
    expect(where).toMatchObject({ status: 'PUBLISHED', deletedAt: null, categoryId: 'cat_123' })
  })

  it('allows an explicit opt-out for the featured hero slot only', () => {
    const where = publishedArticleWhere({ isFeatured: true, isDebate: false })
    expect(where.isDebate).toBe(false)
    expect(where.isFeatured).toBe(true)
    expect(where.status).toBe('PUBLISHED')
  })

  it('extra constraints can narrow but the base constants stay intact', () => {
    expect(PUBLISHED_ARTICLE_WHERE).toEqual({ status: 'PUBLISHED', deletedAt: null })
    // returned object is a fresh copy — callers cannot mutate the shared constant
    const where = publishedArticleWhere({ status: 'PUBLISHED' })
    where.categoryId = 'x'
    expect('categoryId' in PUBLISHED_ARTICLE_WHERE).toBe(false)
  })
})

describe('cache constants', () => {
  it('exposes a stable articles cache tag', () => {
    expect(ARTICLES_CACHE_TAG).toBe('articles')
  })
  it('uses a short, positive revalidation window', () => {
    expect(ARTICLES_REVALIDATE_SECONDS).toBeGreaterThan(0)
    expect(ARTICLES_REVALIDATE_SECONDS).toBeLessThanOrEqual(120)
  })
})
