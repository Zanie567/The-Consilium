import { describe, it, expect } from 'vitest'
import { articleVersion, type VersionedArticle } from '@/lib/articleVersion'

const base: VersionedArticle = {
  title: 'T', slug: 't', content: '{"type":"doc"}', excerpt: null, coverImage: null,
  categoryId: null, authorId: 'u1', status: 'DRAFT', scheduledAt: null,
}

describe('articleVersion', () => {
  it('is stable for identical content and ignores tag order', () => {
    expect(articleVersion(base, ['a', 'b'])).toBe(articleVersion({ ...base }, ['b', 'a']))
  })

  it('treats null and empty optional fields alike (the editor sends "" for none)', () => {
    expect(articleVersion(base, [])).toBe(articleVersion({ ...base, excerpt: '', coverImage: '' }, []))
  })

  it.each([
    ['title', { title: 'T2' }],
    ['slug', { slug: 't2' }],
    ['content', { content: '{"type":"doc","content":[]}' }],
    ['excerpt', { excerpt: 'x' }],
    ['cover image', { coverImage: 'https://x/y.png' }],
    ['category', { categoryId: 'c1' }],
    ['author', { authorId: 'u2' }],
    ['status', { status: 'PUBLISHED' }],
    ['schedule', { scheduledAt: new Date('2030-01-01T00:00:00Z') }],
  ])('changes when the %s changes', (_name, change) => {
    expect(articleVersion({ ...base, ...change }, [])).not.toBe(articleVersion(base, []))
  })

  it('changes when a tag is added or removed', () => {
    expect(articleVersion(base, ['a'])).not.toBe(articleVersion(base, []))
  })

  it('does not depend on view counts or timestamps (not part of the input at all)', () => {
    expect(Object.keys(base)).not.toContain('viewCount')
    expect(Object.keys(base)).not.toContain('updatedAt')
  })
})
