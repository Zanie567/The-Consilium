import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isInOwnAvatarFolder } from '@/lib/avatarUrl'

const BASE = 'https://abcdefgh.supabase.co'
const folder = (id: string, name = 'a.png') => `${BASE}/storage/v1/object/public/avatars/${id}/${name}`

describe('isInOwnAvatarFolder', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE)
  })

  it('accepts a file directly inside the user’s own folder', () => {
    expect(isInOwnAvatarFolder(folder('user-1', '1-photo.png'), 'user-1')).toBe(true)
  })

  it('rejects another user’s folder, including a longer id that shares the prefix', () => {
    expect(isInOwnAvatarFolder(folder('user-2'), 'user-1')).toBe(false)
    expect(isInOwnAvatarFolder(folder('user-10'), 'user-1')).toBe(false)
  })

  it('rejects nested paths, traversal, a bare folder and other buckets', () => {
    expect(isInOwnAvatarFolder(folder('user-1', 'sub/a.png'), 'user-1')).toBe(false)
    expect(isInOwnAvatarFolder(folder('user-1', '../user-2/a.png'), 'user-1')).toBe(false)
    expect(isInOwnAvatarFolder(`${BASE}/storage/v1/object/public/avatars/user-1/`, 'user-1')).toBe(false)
    expect(isInOwnAvatarFolder(`${BASE}/storage/v1/object/public/article-images/user-1/a.png`, 'user-1')).toBe(false)
  })

  it('rejects external URLs, and everything when storage is not configured or the id is unsafe', () => {
    expect(isInOwnAvatarFolder('https://lh3.googleusercontent.com/a/x', 'user-1')).toBe(false)
    expect(isInOwnAvatarFolder(folder('user-1'), '')).toBe(false)
    expect(isInOwnAvatarFolder(folder('user-1'), 'user-1/..')).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(isInOwnAvatarFolder(folder('user-1'), 'user-1')).toBe(false)
  })
})
