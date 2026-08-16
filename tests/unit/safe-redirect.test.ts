import { describe, it, expect } from 'vitest'
import { safeCallbackPath } from '@/lib/safeRedirect'

/**
 * Guards an open redirect: the credentials sign-in form calls
 * `signIn(..., { redirect: false })` and then navigates itself with
 * `window.location.replace(callbackUrl)`, which bypasses NextAuth's own
 * `redirect` callback. `/login?callbackUrl=https://evil.example` therefore sent
 * a freshly-authenticated user straight off the site.
 */
describe('safeCallbackPath', () => {
  it('keeps an ordinary internal path', () => {
    expect(safeCallbackPath('/profile')).toBe('/profile')
    expect(safeCallbackPath('/predictions?tab=all')).toBe('/predictions?tab=all')
  })

  it('falls back when nothing usable is supplied', () => {
    expect(safeCallbackPath(undefined)).toBe('/')
    expect(safeCallbackPath('')).toBe('/')
    expect(safeCallbackPath('   ')).toBe('/')
  })

  it('rejects absolute URLs to another origin', () => {
    expect(safeCallbackPath('https://evil.example/phish')).toBe('/')
    expect(safeCallbackPath('http://evil.example')).toBe('/')
  })

  it('rejects protocol-relative URLs, which browsers treat as another origin', () => {
    expect(safeCallbackPath('//evil.example')).toBe('/')
    expect(safeCallbackPath('//evil.example/path')).toBe('/')
  })

  it('rejects the backslash variant browsers normalise to //', () => {
    expect(safeCallbackPath('/\\evil.example')).toBe('/')
  })

  it('rejects schemes that never start with a slash', () => {
    expect(safeCallbackPath('javascript:alert(1)')).toBe('/')
    expect(safeCallbackPath('data:text/html,<script>alert(1)</script>')).toBe('/')
    expect(safeCallbackPath('evil.example')).toBe('/')
  })

  it('rejects control characters a browser would strip before navigating', () => {
    // `/\n/evil.example` would collapse toward a protocol-relative URL.
    expect(safeCallbackPath(`/${String.fromCharCode(10)}/evil.example`)).toBe('/')
    expect(safeCallbackPath(`/${String.fromCharCode(0)}profile`)).toBe('/')
  })

  it('collapses a repeated callbackUrl parameter to its first value', () => {
    expect(safeCallbackPath(['/profile', 'https://evil.example'])).toBe('/profile')
  })

  it('honours an explicit fallback', () => {
    expect(safeCallbackPath('https://evil.example', '/editorial')).toBe('/editorial')
  })
})
