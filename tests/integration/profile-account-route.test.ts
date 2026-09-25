/**
 * In-process tests for PATCH /api/profile/account — the one route through which a
 * user edits their own profile.
 *
 * The rule under test is the privilege boundary: a user may change their display
 * name, bio and photo, and NOTHING else. Role in particular is admin-only, so a
 * role posted alongside a bio must never reach the database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, authMock } = vi.hoisted(() => ({
  prismaMock: { user: { update: vi.fn() } },
  authMock: { requireVerifiedSessionUser: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)

import { PATCH } from '@/app/api/profile/account/route'

const SUPABASE = 'https://abcdefgh.supabase.co'
const AVATAR = `${SUPABASE}/storage/v1/object/public/avatars/user-1/1-photo.png`

function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/profile/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE
  authMock.requireVerifiedSessionUser.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', role: 'READER', name: 'Reader', email: 'reader@ed.ac.uk' },
  })
  prismaMock.user.update.mockResolvedValue({
    id: 'user-1',
    name: 'Reader',
    bio: null,
    image: null,
  })
})

describe('PATCH /api/profile/account', () => {
  it('updates the caller’s own name, bio and photo', async () => {
    const response = await patch({ name: 'New Name', bio: 'A bio.', image: AVATAR })
    expect(response.status).toBe(200)

    const args = prismaMock.user.update.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'user-1' })
    expect(args.data).toMatchObject({ name: 'New Name', bio: 'A bio.', image: AVATAR })
  })

  it('never writes a role, even when one is posted alongside a valid bio', async () => {
    const response = await patch({ bio: 'A bio.', role: 'ADMIN' })
    expect(response.status).toBe(200)

    const { data } = prismaMock.user.update.mock.calls[0][0]
    expect(data).not.toHaveProperty('role')
    expect(data).toEqual({ bio: 'A bio.' })
  })

  it('ignores every other privileged field a client might post', async () => {
    await patch({
      name: 'Name',
      role: 'ADMIN',
      isBanned: false,
      isActive: true,
      email: 'someone-else@ed.ac.uk',
      slug: 'stolen-slug',
      id: 'another-user',
    })

    const { where, data } = prismaMock.user.update.mock.calls[0][0]
    expect(where).toEqual({ id: 'user-1' })
    expect(data).toEqual({ name: 'Name' })
  })

  it('rejects an avatar hosted anywhere but our own avatars bucket', async () => {
    const response = await patch({ image: 'https://evil.example.com/pixel.png' })
    expect(response.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('accepts an empty image as clearing the photo', async () => {
    const response = await patch({ image: '' })
    expect(response.status).toBe(200)
    expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ image: null })
  })

  it('rejects a bio longer than the limit', async () => {
    const response = await patch({ bio: 'x'.repeat(601) })
    expect(response.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('leaves fields absent from the body untouched', async () => {
    await patch({ bio: 'Only the bio.' })
    expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ bio: 'Only the bio.' })
  })
})
