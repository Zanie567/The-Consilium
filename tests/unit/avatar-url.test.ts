import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateAvatarUrl } from '@/lib/avatarUrl'

const SUPABASE = 'https://abcdefgh.supabase.co'
const VALID = `${SUPABASE}/storage/v1/object/public/avatars/user-1/1700000000-photo.png`

let original: string | undefined

beforeEach(() => {
  original = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = original
})

describe('validateAvatarUrl', () => {
  it('accepts a file in our own avatars bucket', () => {
    expect(validateAvatarUrl(VALID)).toEqual({ ok: true, url: VALID })
  })

  it('accepts HTTP only for the explicitly enabled local test storage', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('E2E_ISOLATED', '0')
    vi.stubEnv('NEXT_IMAGE_ALLOW_LOCAL_STORAGE', '1')
    const local='http://127.0.0.1:54321/storage/v1/object/public/avatars/x.png'
    expect(validateAvatarUrl(local).ok).toBe(false)
    vi.stubEnv('E2E_ISOLATED', '1')
    expect(validateAvatarUrl(local)).toEqual({ok:true,url:local})
    expect(validateAvatarUrl(local.replace('54321','54322')).ok).toBe(false)
    expect(validateAvatarUrl(local.replace('/avatars/', '/article-images/')).ok).toBe(false)
  })

  it('treats an empty value as clearing the avatar', () => {
    expect(validateAvatarUrl('')).toEqual({ ok: true, url: null })
    expect(validateAvatarUrl('   ')).toEqual({ ok: true, url: null })
  })

  it('rejects a URL on any other host', () => {
    // The point of the check: a stored URL renders on public pages, so an
    // arbitrary address is a tracking pixel or content we cannot take down.
    for (const url of [
      'https://evil.example.com/pixel.png',
      'https://images.unsplash.com/photo-123',
      'https://abcdefgh.supabase.co.evil.example.com/storage/v1/object/public/avatars/x.png',
    ]) {
      expect(validateAvatarUrl(url).ok).toBe(false)
    }
  })

  it('rejects another bucket on our own Supabase project', () => {
    const otherBucket = `${SUPABASE}/storage/v1/object/public/article-images/x.png`
    expect(validateAvatarUrl(otherBucket).ok).toBe(false)
  })

  it('rejects non-https schemes, including javascript: and data:', () => {
    for (const url of [
      'http://abcdefgh.supabase.co/storage/v1/object/public/avatars/x.png',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
    ]) {
      expect(validateAvatarUrl(url).ok).toBe(false)
    }
  })

  it('rejects a bare prefix with no file, and path traversal', () => {
    expect(validateAvatarUrl(`${SUPABASE}/storage/v1/object/public/avatars/`).ok).toBe(false)
    expect(
      validateAvatarUrl(`${SUPABASE}/storage/v1/object/public/avatars/../article-images/x.png`).ok,
    ).toBe(false)
  })

  it('rejects text that is not a URL at all', () => {
    expect(validateAvatarUrl('not a url').ok).toBe(false)
  })

  it('fails closed when storage is not configured', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    expect(validateAvatarUrl(VALID).ok).toBe(false)
  })
})
