import { expect, it } from 'vitest'
import { publicAuthorPath } from '@/lib/authorUtils'

it('offers the public author page, by slug when there is one and by id otherwise', () => {
  expect(publicAuthorPath({ id: 'user-1', slug: 'jane-doe', role: 'WRITER' })).toBe('/author/jane-doe')
  expect(publicAuthorPath({ id: 'user-1', slug: null, role: 'EDITOR' })).toBe('/author/user-1')
  expect(publicAuthorPath({ id: 'user-1', slug: null, role: 'ADMIN' })).toBe('/author/user-1')
})

it('offers nothing for roles that have no public author page, and never the private /profile address', () => {
  for (const role of ['READER', 'GROWTH', 'SOMETHING_ELSE'])
    expect(publicAuthorPath({ id: 'user-1', slug: 'jane-doe', role })).toBeNull()
})
