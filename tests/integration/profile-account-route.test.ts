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

const { prismaMock, authMock, storageMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { update: vi.fn(), findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  },
  authMock: { requireVerifiedSessionUser: vi.fn() },
  storageMock: { removeTeamPhoto: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/teamPhotoStorage', () => storageMock)

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
    displayTitles: [],
  })
  prismaMock.user.findUnique.mockResolvedValue({ image: null })
  prismaMock.teamMember.findFirst.mockResolvedValue(null)
})

function asRole(role: string) {
  authMock.requireVerifiedSessionUser.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', role, name: 'Someone', email: 'someone@ed.ac.uk' },
  })
}

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
    expect(response.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('never writes a role, even for an admin editing their own profile', async () => {
    asRole('ADMIN')
    const response = await patch({ displayTitles: ['Writer'], role: 'READER' })
    expect(response.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects every other privileged field instead of writing it', async () => {
    for (const extra of [
      { role: 'ADMIN' },
      { isBanned: false },
      { isActive: true },
      { email: 'someone-else@ed.ac.uk' },
      { slug: 'stolen-slug' },
      { id: 'another-user' },
      { userId: 'another-user' },
    ]) {
      const response = await patch({ name: 'Name', ...extra })
      expect(response.status).toBe(400)
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('always updates the session user, never an id from the request', async () => {
    await patch({ name: 'Name' })
    expect(prismaMock.user.update.mock.calls[0][0].where).toEqual({ id: 'user-1' })
  })

  describe('display titles', () => {
    it('refuses a non-admin who sends displayTitles, and writes nothing', async () => {
      for (const role of ['READER', 'WRITER', 'EDITOR', 'GROWTH']) {
        asRole(role)
        const response = await patch({ displayTitles: ['Editor-in-Chief'] })
        expect(response.status).toBe(403)
      }
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('refuses a non-admin even when the titles ride along with a valid bio', async () => {
      asRole('WRITER')
      const response = await patch({ bio: 'A bio.', displayTitles: ['Writer'] })
      expect(response.status).toBe(403)
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('lets an admin set their own titles, without touching role', async () => {
      asRole('ADMIN')
      const response = await patch({ displayTitles: ['Deputy Editor-in-Chief', 'Writer'] })
      expect(response.status).toBe(200)
      const { where, data } = prismaMock.user.update.mock.calls[0][0]
      expect(where).toEqual({ id: 'user-1' })
      expect(data).toEqual({ displayTitles: ['Deputy Editor-in-Chief', 'Writer'] })
      expect(data).not.toHaveProperty('role')
    })

    it('rejects titles outside the allowed list, duplicates, more than four, and non-arrays', async () => {
      asRole('ADMIN')
      for (const bad of [
        ['Chief Wizard'],
        ['Leadership'],
        ['Writer', 'Writer'],
        ['Editor', 'Writer', 'Senior Editor', 'Junior Editor', 'Editor-in-Chief'],
        'Writer',
        [1],
      ]) {
        const response = await patch({ displayTitles: bad })
        expect(response.status).toBe(400)
      }
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('accepts an empty array, clearing the titles', async () => {
      asRole('ADMIN')
      const response = await patch({ displayTitles: [] })
      expect(response.status).toBe(200)
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ displayTitles: [] })
    })
  })

  describe('photo ownership', () => {
    const OWN = `${SUPABASE}/storage/v1/object/public/avatars/user-1/2-mine.png`
    const OTHER = `${SUPABASE}/storage/v1/object/public/avatars/user-2/1-theirs.png`
    const GOOGLE = 'https://lh3.googleusercontent.com/a/some-profile-picture'

    it('accepts a file inside the caller’s own folder', async () => {
      const response = await patch({ image: OWN })
      expect(response.status).toBe(200)
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ image: OWN })
    })

    it('rejects a file inside another user’s folder, and writes nothing', async () => {
      const response = await patch({ image: OTHER })
      expect(response.status).toBe(400)
      expect(prismaMock.user.update).not.toHaveBeenCalled()
      expect(storageMock.removeTeamPhoto).not.toHaveBeenCalled()
    })

    it('rejects nested paths and traversal inside the caller’s own folder prefix', async () => {
      for (const image of [
        `${SUPABASE}/storage/v1/object/public/avatars/user-1/sub/x.png`,
        `${SUPABASE}/storage/v1/object/public/avatars/user-1/../user-2/x.png`,
        `${SUPABASE}/storage/v1/object/public/avatars/user-10/x.png`,
        `${SUPABASE}/storage/v1/object/public/avatars/user-1`,
      ]) {
        const response = await patch({ image })
        expect(response.status).toBe(400)
      }
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('accepts an image identical to the stored one without re-validating or rewriting it', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: OTHER })
      const response = await patch({ name: 'Same Photo', image: OTHER })
      expect(response.status).toBe(200)
      const { data } = prismaMock.user.update.mock.calls[0][0]
      expect(data).toEqual({ name: 'Same Photo' })
      expect(storageMock.removeTeamPhoto).not.toHaveBeenCalled()
    })

    it('preserves an external existing image when only the name is saved', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: GOOGLE })
      const response = await patch({ name: 'New Name' })
      expect(response.status).toBe(200)
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ name: 'New Name' })
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
      expect(storageMock.removeTeamPhoto).not.toHaveBeenCalled()
    })

    it('accepts the same external image sent back unchanged, but not a different external one', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: GOOGLE })
      const same = await patch({ image: GOOGLE })
      expect(same.status).toBe(200)
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({})

      prismaMock.user.update.mockClear()
      const different = await patch({ image: 'https://lh3.googleusercontent.com/a/another-one' })
      expect(different.status).toBe(400)
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('still lets a user with an external image replace it with their own upload, and clear it', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: GOOGLE })
      expect((await patch({ image: OWN })).status).toBe(200)
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ image: OWN })
      // The external image is not ours to delete from storage.
      prismaMock.user.update.mockClear()
      expect((await patch({ image: '' })).status).toBe(200)
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ image: null })
    })
  })

  describe('replacing or removing the photo', () => {
    const OLD = `${SUPABASE}/storage/v1/object/public/avatars/user-1/old.png`

    it('removes the old file only after the row update succeeds', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: OLD })
      const order: string[] = []
      prismaMock.user.update.mockImplementation(async () => {
        order.push('update')
        return { id: 'user-1', name: 'R', bio: null, image: AVATAR, displayTitles: [] }
      })
      storageMock.removeTeamPhoto.mockImplementation(async () => {
        order.push('remove')
      })
      await patch({ image: AVATAR })
      expect(order).toEqual(['update', 'remove'])
      expect(storageMock.removeTeamPhoto).toHaveBeenCalledWith(OLD, 'user-1')
    })

    it('removes the file when the photo is cleared', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: OLD })
      await patch({ image: '' })
      expect(storageMock.removeTeamPhoto).toHaveBeenCalledWith(OLD, 'user-1')
    })

    it('does not remove anything when the update fails', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: OLD })
      prismaMock.user.update.mockRejectedValue(new Error('db down'))
      const response = await patch({ image: AVATAR })
      expect(response.status).toBe(500)
      expect(storageMock.removeTeamPhoto).not.toHaveBeenCalled()
    })

    it('does not remove a file that is still used by a team card', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ image: OLD })
      prismaMock.teamMember.findFirst.mockResolvedValue({ id: 'card-1' })
      await patch({ image: AVATAR })
      expect(storageMock.removeTeamPhoto).not.toHaveBeenCalled()
    })

    it('leaves storage alone when the image is not part of the request', async () => {
      await patch({ name: 'Just a name' })
      expect(storageMock.removeTeamPhoto).not.toHaveBeenCalled()
    })
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
