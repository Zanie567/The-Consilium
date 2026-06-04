import { describe, it, expect } from 'vitest'
import { PUBLIC_AUTHOR_SELECT, SENSITIVE_USER_FIELDS } from '@/lib/publicUser'

/**
 * Guards the fix for the P0 author-data leak: `GET /api/articles` and
 * `GET /api/articles/[id]` previously returned `include: { author: true }`,
 * serialising the author's password hash, email and account-security columns to
 * anonymous callers. The public author select must expose only byline fields.
 */
describe('PUBLIC_AUTHOR_SELECT', () => {
  it('selects only safe byline fields', () => {
    expect(Object.keys(PUBLIC_AUTHOR_SELECT).sort()).toEqual(
      ['bio', 'id', 'image', 'name', 'slug'].sort()
    )
  })

  it('every selected field is enabled (true)', () => {
    for (const v of Object.values(PUBLIC_AUTHOR_SELECT)) {
      expect(v).toBe(true)
    }
  })

  it('never selects a sensitive user field', () => {
    const selected = new Set(Object.keys(PUBLIC_AUTHOR_SELECT))
    for (const sensitive of SENSITIVE_USER_FIELDS) {
      expect(selected.has(sensitive)).toBe(false)
    }
  })

  it('explicitly excludes the password hash and email', () => {
    expect('password' in PUBLIC_AUTHOR_SELECT).toBe(false)
    expect('email' in PUBLIC_AUTHOR_SELECT).toBe(false)
  })
})
