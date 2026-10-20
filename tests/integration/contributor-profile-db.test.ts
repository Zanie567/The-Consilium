/**
 * One contributor profile, edited from any screen, against a REAL Postgres: the account page
 * (PATCH /api/profile/account), the editorial Team Profile (PUT /api/team-profile), the admin Team
 * Members editor (PUT /api/team/[id]) and the admin user editor (PATCH /api/editorial/users/[id]).
 * Each save must reach the account AND the linked card, show up on Our Team and the author page,
 * leave permissions/title/placement/visibility alone, refuse stale forms, and never lose a
 * biography or photo that only one of the two records held.
 *
 * Auth and Supabase Storage are faked at their module boundaries; Prisma, the row locks, the
 * unique index and the audit table are real. Runs only under the isolated launcher.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient, Prisma, type Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL

async function schemaIsReady(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(
      `select 1 from information_schema.columns where table_name = 'team_members' and column_name = 'userId'`,
    )
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end()
  }
}

const ready = await schemaIsReady()
if (!ready) throw new Error('Required isolated contributor profile database is unavailable or missing its schema')

const { state, storage } = vi.hoisted(() => ({
  state: { prisma: undefined as unknown, session: null as null | { id: string } },
  storage: { uploads: [] as string[], removed: [] as string[], failUpload: false },
}))

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return state.prisma
  },
}))

// Same contract as the real helpers (re-read the user and role from the database).
vi.mock('@/lib/auth', () => {
  const load = async (allowed?: readonly Role[]) => {
    const db = state.prisma as PrismaClient
    if (!state.session) return { ok: false as const, status: 401 }
    const user = await db.user.findUnique({ where: { id: state.session.id } })
    if (!user || !user.isActive || user.isBanned) return { ok: false as const, status: 401 }
    if (allowed && !allowed.includes(user.role)) return { ok: false as const, status: 403 }
    return { ok: true as const, user: { id: user.id, role: user.role, name: user.name, email: user.email } }
  }
  return {
    getVerifiedSessionUser: async (allowed?: readonly Role[]) => {
      const result = await load(allowed)
      return result.ok ? result.user : null
    },
    requireVerifiedSessionUser: async (allowed?: readonly Role[]) => {
      const result = await load(allowed)
      return result.ok ? result : { ok: false, response: NextResponse.json({ error: 'no' }, { status: result.status }) }
    },
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (storage.failUpload) return { error: { message: 'boom' } }
          storage.uploads.push(path)
          return { error: null }
        },
        remove: async (paths: string[]) => {
          storage.removed.push(...paths)
          return { error: null }
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${BUCKET}${path}` } }),
      }),
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: () => {} }))

import { PATCH as accountPatch } from '@/app/api/profile/account/route'
import { PUT as teamProfilePut } from '@/app/api/team-profile/route'
import { PUT as adminCardPut } from '@/app/api/team/[id]/route'
import { PATCH as adminUserPatch } from '@/app/api/editorial/users/[id]/route'
import { loadPublicTeam } from '@/lib/publicTeam'
import { visibleAuthorProfile } from '@/lib/teamProfiles'
import { profileEditorState } from '@/lib/profileFields'

const SUPABASE = 'https://test.supabase.co'
const BUCKET = `${SUPABASE}/storage/v1/object/public/avatars/`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])

let db: PrismaClient
const tag = `cp-${Date.now()}`
let seq = 0

const as = (user: { id: string } | null) => { state.session = user ? { id: user.id } : null }

function patchAccount(body: unknown) {
  return accountPatch(new NextRequest('http://localhost/api/profile/account', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

function putTeamProfile(fields: Record<string, string | File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return teamProfilePut(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
}

function putAdminCard(id: string, body: unknown) {
  return adminCardPut(new NextRequest(`http://localhost/api/team/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })
}

function patchAdminUser(id: string, body: unknown) {
  return adminUserPatch(new NextRequest(`http://localhost/api/editorial/users/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })
}

const photo = (bytes: Uint8Array = PNG, name = 'me.png', type = 'image/png') => new File([bytes as BlobPart], name, { type })
const ownUrl = (userId: string, file = `${++seq}-photo.png`) => `${BUCKET}${userId}/${file}`

async function makeUser(role: Role, label: string, extra: Partial<Prisma.UserCreateInput> = {}) {
  return db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${tag} ${label}`, role, ...extra } })
}

/** A staff account with a linked card, as an administrator would have set it up. */
async function contributor(
  role: Role,
  label: string,
  card: Partial<Prisma.TeamMemberUncheckedCreateInput> = {},
  account: Partial<Prisma.UserCreateInput> = {},
) {
  const user = await makeUser(role, label, { bio: 'Shared bio.', ...account })
  const position = { WRITER: 'Writer', EDITOR: 'Editor', GROWTH: 'Growth & Communications', ADMIN: 'Editor-in-Chief', READER: 'Writer' }[role]
  const row = await db.teamMember.create({
    data: {
      userId: user.id, name: user.name!, role: position, publicTier: role === 'ADMIN' ? 'editor_in_chief' : null,
      bio: 'Shared bio.', order: 500, isActive: true, ...card,
    },
  })
  return { user, card: row }
}

const accountOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } })
const cardOf = (userId: string) => db.teamMember.findUniqueOrThrow({ where: { userId } })

async function authorPage(userId: string) {
  const author = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, slug: true, bio: true, image: true, isActive: true, isBanned: true, displayTitles: true,
      teamProfile: { select: { name: true, role: true, publicTier: true, bio: true, image: true, isActive: true } },
    },
  })
  return { name: author.name, ...visibleAuthorProfile(author, { testingMode: false }) }
}

async function rosterEntry(cardId: string) {
  return (await loadPublicTeam()).find((member) => member.id === cardId) ?? null
}

/** What the account page and the editorial Team Profile both start from. */
async function editorValues(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { teamProfile: true } })
  return profileEditorState(user, user.teamProfile, { testingMode: false }).view
}

const audits = (userId: string) =>
  db.auditLog.findMany({ where: { targetId: userId, action: 'CONTRIBUTOR_PROFILE_UPDATED' }, orderBy: { createdAt: 'asc' } })

describe('one contributor profile across every editing screen (real database)', () => {
  let admin: { id: string }

  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) })
    state.prisma = db
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only'
    admin = await makeUser('ADMIN', 'the-admin')
  })

  beforeEach(() => {
    as(null)
    storage.uploads.length = 0
    storage.removed.length = 0
    storage.failUpload = false
  })

  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: users.map((u) => u.id) } }, { performedBy: { in: users.map((u) => u.id) } }] } })
    await db.teamMember.deleteMany({ where: { OR: [{ user: { email: { startsWith: tag } } }, { name: { startsWith: tag } }] } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('A: a writer edits the biography on the account page; every surface shows it', async () => {
    const { user, card } = await contributor('WRITER', 'a')
    as(user)
    const res = await patchAccount({ bio: 'Written on /profile.', expected: { bio: 'Shared bio.' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toMatchObject({ linked: true, values: { bio: 'Written on /profile.' }, accountDiffers: {} })

    expect((await accountOf(user.id)).bio).toBe('Written on /profile.')
    expect((await cardOf(user.id)).bio).toBe('Written on /profile.')
    expect((await editorValues(user.id)).values.bio).toBe('Written on /profile.') // both editors, after reload
    expect((await rosterEntry(card.id))?.bio).toBe('Written on /profile.')
    expect((await authorPage(user.id)).bio).toBe('Written on /profile.')
  })

  it('B: the same writer edits the Team Profile; the account page and public pages follow', async () => {
    const { user, card } = await contributor('WRITER', 'b')
    as(user)
    const res = await putTeamProfile({ bio: 'Written on the Team Profile.', expectedBio: 'Shared bio.', name: `${tag} b renamed`, expectedName: `${tag} b` })
    expect(res.status).toBe(200)
    const account = await accountOf(user.id)
    expect(account).toMatchObject({ bio: 'Written on the Team Profile.', name: `${tag} b renamed` })
    expect(await cardOf(user.id)).toMatchObject({ bio: 'Written on the Team Profile.', name: `${tag} b renamed` })
    expect((await rosterEntry(card.id))?.bio).toBe('Written on the Team Profile.')
    expect(await authorPage(user.id)).toMatchObject({ bio: 'Written on the Team Profile.', name: `${tag} b renamed` })
    // A name change never touches the stored slug (article and author links stay valid).
    expect(account.slug).toBe(user.slug)
  })

  it('C: an administrator edits the biography in Team Members; the account follows, nothing else changes', async () => {
    const { user, card } = await contributor('EDITOR', 'c', { publicTier: 'editor', order: 42 }, { displayTitles: ['Editor'] })
    as(admin)
    const res = await putAdminCard(card.id, {
      name: card.name, position: card.role, publicTier: card.publicTier, bio: 'Admin wrote this.', image: null, email: null, order: 42,
      expectedUpdatedAt: card.updatedAt.toISOString(),
    })
    expect(res.status).toBe(200)
    const account = await accountOf(user.id)
    const after = await cardOf(user.id)
    expect(account.bio).toBe('Admin wrote this.')
    expect(after.bio).toBe('Admin wrote this.')
    // Permissions, appointment, placement, order and visibility untouched.
    expect(account.role).toBe('EDITOR')
    expect(account.displayTitles).toEqual(['Editor'])
    expect(after).toMatchObject({ role: 'Editor', publicTier: 'editor', order: 42, isActive: true, userId: user.id })
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: card.id, action: 'TEAM_CARD_UPDATED' }, orderBy: { createdAt: 'desc' } })
    expect(log.performedBy).toBe(admin.id)
    expect(log.metadata).toMatchObject({ accountFields: ['bio'], previousAccountValues: { bio: 'Shared bio.' } })
    expect((await rosterEntry(card.id))?.bio).toBe('Admin wrote this.')
  })

  it('C: the admin user editor also keeps the card in step, stale-checked', async () => {
    const { user } = await contributor('WRITER', 'c2')
    as(admin)
    expect((await patchAdminUser(user.id, { bio: 'From the user editor.', expected: { bio: 'Shared bio.' } })).status).toBe(200)
    expect((await cardOf(user.id)).bio).toBe('From the user editor.')
    const stale = await patchAdminUser(user.id, { bio: 'Older screen.', expected: { bio: 'Shared bio.' } })
    expect(stale.status).toBe(409)
    expect((await accountOf(user.id)).bio).toBe('From the user editor.')
  })

  describe('D: photographs', () => {
    it('a Team Profile upload becomes the account photo too; the replaced files go only once unused', async () => {
      const { user } = await contributor('WRITER', 'd1')
      const accountPhoto = ownUrl(user.id)
      const cardPhoto = ownUrl(user.id)
      await db.user.update({ where: { id: user.id }, data: { image: accountPhoto } })
      await db.teamMember.update({ where: { userId: user.id }, data: { image: cardPhoto } })
      as(user)
      const res = await putTeamProfile({ image: photo(), expectedImage: cardPhoto })
      expect(res.status).toBe(200)
      const uploaded = `${BUCKET}${storage.uploads[0]}`
      expect((await accountOf(user.id)).image).toBe(uploaded)
      expect((await cardOf(user.id)).image).toBe(uploaded)
      expect(storage.removed.sort()).toEqual([accountPhoto, cardPhoto].map((u) => u.slice(BUCKET.length)).sort())
    })

    it('an account-page photo becomes the team photo; removing it from either screen clears both', async () => {
      const { user, card } = await contributor('GROWTH', 'd2')
      as(user)
      const mine = ownUrl(user.id)
      expect((await patchAccount({ image: mine, expected: { image: null } })).status).toBe(200)
      expect((await cardOf(user.id)).image).toBe(mine)
      expect((await rosterEntry(card.id))?.image).toBe(mine)

      expect((await putTeamProfile({ removeImage: 'true', expectedImage: mine })).status).toBe(200)
      expect((await accountOf(user.id)).image).toBeNull()
      expect((await cardOf(user.id)).image).toBeNull()
      expect(storage.removed).toEqual([mine.slice(BUCKET.length)])
    })

    it('never deletes a file another record still points at', async () => {
      const { user } = await contributor('WRITER', 'd3')
      const shared = ownUrl(user.id)
      await db.user.update({ where: { id: user.id }, data: { image: shared } })
      // A different (legacy) card happens to use the same file.
      await db.teamMember.create({ data: { name: `${tag} legacy-d3`, role: 'Writer', image: shared, isActive: false } })
      as(user)
      expect((await patchAccount({ image: ownUrl(user.id), expected: { image: null } })).status).toBe(200)
      expect(storage.removed).toEqual([])
    })

    it('refuses someone else’s file, a foreign URL and a GIF, writing nothing', async () => {
      const { user } = await contributor('WRITER', 'd4')
      const other = await makeUser('WRITER', 'd4-other')
      as(user)
      for (const image of [ownUrl(other.id), 'https://evil.example.com/pixel.png']) {
        expect((await patchAccount({ image })).status).toBe(400)
      }
      const gif = await putTeamProfile({ image: photo(GIF, 'x.gif', 'image/gif') })
      expect(gif.status).toBe(400)
      expect(storage.uploads).toEqual([])
      expect((await accountOf(user.id)).image).toBeNull()
      expect((await cardOf(user.id)).image).toBeNull()
    })

    it('a failed upload changes nothing; a refused save removes the file it had just uploaded', async () => {
      const { user } = await contributor('WRITER', 'd5')
      as(user)
      storage.failUpload = true
      expect((await putTeamProfile({ image: photo(), bio: 'Not saved' })).status).toBe(502)
      expect((await cardOf(user.id)).bio).toBe('Shared bio.')
      storage.failUpload = false
      const stale = await putTeamProfile({ image: photo(), expectedImage: ownUrl(user.id) })
      expect(stale.status).toBe(409)
      expect(storage.removed).toEqual(storage.uploads)
      expect((await cardOf(user.id)).image).toBeNull()
    })
  })

  describe('E: account types', () => {
    it('a reader edits only their account; no card appears and no audit row is written', async () => {
      const reader = await makeUser('READER', 'e-reader')
      as(reader)
      expect((await patchAccount({ bio: 'Reader bio.', name: 'Reader Name' })).status).toBe(200)
      expect(await accountOf(reader.id)).toMatchObject({ bio: 'Reader bio.', name: 'Reader Name', role: 'READER' })
      expect(await db.teamMember.count({ where: { userId: reader.id } })).toBe(0)
      expect(await audits(reader.id)).toHaveLength(0)
      expect((await putTeamProfile({ bio: 'try' })).status).toBe(403)
    })

    it.each(['WRITER', 'EDITOR', 'GROWTH', 'ADMIN'] as const)('a linked %s is kept in step from the account page', async (role) => {
      const { user } = await contributor(role, `e-${role}`)
      as(user)
      expect((await patchAccount({ name: `${tag} ${role} new`, expected: { name: `${tag} e-${role}` } })).status).toBe(200)
      expect((await cardOf(user.id)).name).toBe(`${tag} ${role} new`)
      expect((await accountOf(user.id)).role).toBe(role)
    })

    it('an administrator without a card edits the account only, and cannot create a card for themselves', async () => {
      const lone = await makeUser('ADMIN', 'e-admin-lone')
      as(lone)
      expect((await patchAccount({ bio: 'Admin bio.' })).status).toBe(200)
      expect(await db.teamMember.count({ where: { userId: lone.id } })).toBe(0)
      expect((await putTeamProfile({ bio: 'x' })).status).toBe(403)
    })

    it('a reader whose old card was kept edits only the account, never that card', async () => {
      const { user } = await contributor('READER', 'e-revoked')
      as(user)
      expect((await patchAccount({ bio: 'Now a reader.' })).status).toBe(200)
      expect((await cardOf(user.id)).bio).toBe('Shared bio.')
    })
  })

  describe('F: no card yet, and legacy cards', () => {
    it('account edits made before a card exists are carried into the new, hidden card', async () => {
      const writer = await makeUser('WRITER', 'f-new')
      as(writer)
      const mine = ownUrl(writer.id)
      expect((await patchAccount({ bio: 'Written before any card.', image: mine })).status).toBe(200)
      expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(0)

      const res = await putTeamProfile({ expectedBio: 'Written before any card.', expectedImage: mine })
      expect(res.status).toBe(201)
      expect(await cardOf(writer.id)).toMatchObject({ bio: 'Written before any card.', image: mine, isActive: false, name: writer.name })
      expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(1)
    })

    it('never claims or edits a legacy card that only shares a name, and creates no duplicate', async () => {
      const writer = await makeUser('WRITER', 'f-legacy')
      const legacy = await db.teamMember.create({ data: { name: writer.name!, role: 'Writer', bio: 'Legacy bio.', isActive: true } })
      as(writer)
      expect((await patchAccount({ bio: 'Account only.' })).status).toBe(200)
      expect(await db.teamMember.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ userId: null, bio: 'Legacy bio.' })
      const res = await putTeamProfile({ bio: 'try' })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('LEGACY_CARD_NEEDS_LINK')
      expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(0)
    })
  })

  it('G: editing a hidden card updates it without publishing it', async () => {
    const { user, card } = await contributor('WRITER', 'g', { isActive: false })
    as(user)
    expect((await patchAccount({ bio: 'Hidden but updated.' })).status).toBe(200)
    expect(await cardOf(user.id)).toMatchObject({ bio: 'Hidden but updated.', isActive: false })
    expect(await rosterEntry(card.id)).toBeNull()
  })

  describe('H: security', () => {
    it('refuses protected fields on every self-service route, and changes nothing', async () => {
      const { user } = await contributor('WRITER', 'h')
      const victim = await contributor('EDITOR', 'h-victim')
      as(user)
      for (const forged of [{ role: 'ADMIN' }, { isActive: false }, { userId: victim.user.id }, { email: 'x@y.z' }, { slug: 'x' }, { publicTier: 'editor_in_chief' }]) {
        expect((await patchAccount({ bio: 'x', ...forged })).status).toBe(400)
      }
      expect((await patchAccount({ bio: 'x', expected: { role: 'WRITER' } })).status).toBe(400)
      const forgedFields: Record<string, string>[] = [{ role: 'EDITOR' }, { position: 'Editor-in-Chief' }, { userId: victim.user.id }, { isActive: 'true' }, { order: '1' }]
      for (const forged of forgedFields) {
        expect((await putTeamProfile({ bio: 'x', ...forged })).status).toBe(400)
      }
      expect((await putAdminCard(victim.card.id, { bio: 'hijack' })).status).toBe(401)
      expect((await patchAdminUser(victim.user.id, { bio: 'hijack' })).status).toBe(403)
      expect(await accountOf(user.id)).toMatchObject({ role: 'WRITER', bio: 'Shared bio.', isActive: true })
      expect(await cardOf(user.id)).toMatchObject({ role: 'Writer', isActive: true, bio: 'Shared bio.' })
      expect(await cardOf(victim.user.id)).toMatchObject({ bio: 'Shared bio.' })
      expect((await accountOf(victim.user.id)).bio).toBe('Shared bio.')
    })

    it('refuses to clear the biography of a published card from either screen', async () => {
      const { user } = await contributor('WRITER', 'h-bio')
      as(user)
      expect((await patchAccount({ bio: '' })).status).toBe(400)
      expect((await putTeamProfile({ bio: '' })).status).toBe(400)
      expect((await cardOf(user.id)).bio).toBe('Shared bio.')
      expect((await accountOf(user.id)).bio).toBe('Shared bio.')
    })

    it('a suspended account cannot save at all', async () => {
      const { user } = await contributor('WRITER', 'h-banned', {}, { isBanned: true })
      as(user)
      expect((await patchAccount({ bio: 'x' })).status).toBe(401)
      expect((await putTeamProfile({ bio: 'x' })).status).toBe(401)
    })
  })

  describe('I: concurrency and failures', () => {
    it('refuses a stale form instead of overwriting a newer save', async () => {
      const { user } = await contributor('WRITER', 'i-stale')
      as(user)
      expect((await putTeamProfile({ bio: 'Newer, from the Team Profile.', expectedBio: 'Shared bio.' })).status).toBe(200)
      const stale = await patchAccount({ bio: 'Older tab.', expected: { bio: 'Shared bio.' } })
      expect(stale.status).toBe(409)
      expect((await stale.json()).code).toBe('STALE')
      expect((await accountOf(user.id)).bio).toBe('Newer, from the Team Profile.')
      expect((await cardOf(user.id)).bio).toBe('Newer, from the Team Profile.')
    })

    it('two simultaneous saves from the same starting point: one wins, the other is refused', async () => {
      const { user } = await contributor('EDITOR', 'i-race')
      as(user)
      const results = await Promise.all([
        patchAccount({ bio: 'First.', expected: { bio: 'Shared bio.' } }),
        putTeamProfile({ bio: 'Second.', expectedBio: 'Shared bio.' }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      const account = await accountOf(user.id)
      const card = await cardOf(user.id)
      expect(account.bio).toBe(card.bio)
      expect(['First.', 'Second.']).toContain(card.bio)
    })

    it('an administrator’s stale card form is refused after the member saved', async () => {
      const { user, card } = await contributor('WRITER', 'i-admin')
      as(user)
      expect((await patchAccount({ bio: 'Member saved.' })).status).toBe(200)
      as(admin)
      const res = await putAdminCard(card.id, { bio: 'Admin from an old screen.', expectedUpdatedAt: card.updatedAt.toISOString() })
      expect(res.status).toBe(409)
      expect((await accountOf(user.id)).bio).toBe('Member saved.')
    })

    it('a failed database write leaves both records as they were', async () => {
      const { user } = await contributor('WRITER', 'i-fail')
      as(user)
      const realTransaction = db.$transaction.bind(db)
      const spy = vi.spyOn(db, '$transaction').mockImplementationOnce((async (fn: (tx: Prisma.TransactionClient) => unknown) =>
        realTransaction(async (tx) => {
          await fn(tx)
          throw new Error('connection lost before commit')
        })) as never)
      const res = await patchAccount({ bio: 'Never committed.' })
      spy.mockRestore()
      expect(res.status).toBe(500)
      expect((await accountOf(user.id)).bio).toBe('Shared bio.')
      expect((await cardOf(user.id)).bio).toBe('Shared bio.')
    })
  })

  describe('J: details that already differ', () => {
    const detailed = 'A long and detailed biography written on the account page, with plenty of context.'

    it('an unrelated save never overwrites a biography that exists on only one record', async () => {
      const { user, card } = await contributor('WRITER', 'j1', { bio: 'Short old card bio.' }, { bio: detailed })
      expect((await editorValues(user.id)).accountDiffers).toEqual({ bio: detailed })
      as(user)
      expect((await patchAccount({ name: `${tag} j1 renamed`, expected: { name: `${tag} j1` } })).status).toBe(200)
      expect((await accountOf(user.id)).bio).toBe(detailed)
      expect((await cardOf(user.id)).bio).toBe('Short old card bio.')
      // Nor does an administrator changing only the order.
      as(admin)
      const fresh = await cardOf(user.id)
      expect((await putAdminCard(card.id, { order: 7, expectedUpdatedAt: fresh.updatedAt.toISOString() })).status).toBe(200)
      expect((await accountOf(user.id)).bio).toBe(detailed)
      // Public pages are exactly as before.
      expect((await rosterEntry(card.id))?.bio).toBe('Short old card bio.')
    })

    it('choosing the account version keeps the card text in the audit log', async () => {
      const { user } = await contributor('WRITER', 'j2', { bio: 'Short old card bio.' }, { bio: detailed })
      as(user)
      expect((await patchAccount({ bio: detailed, expected: { bio: 'Short old card bio.' } })).status).toBe(200)
      expect((await cardOf(user.id)).bio).toBe(detailed)
      const [log] = await audits(user.id)
      expect(log.metadata).toMatchObject({ via: 'account', fields: ['bio'], previous: { card: { bio: 'Short old card bio.' } } })
      expect((await editorValues(user.id)).accountDiffers).toEqual({})
    })

    it('choosing the team photo for the account keeps the old account photo reference, and its file', async () => {
      const google = 'https://lh3.googleusercontent.com/a/sign-in-photo'
      const { user } = await contributor('WRITER', 'j3', {}, { image: google })
      const teamPhoto = ownUrl(user.id)
      await db.teamMember.update({ where: { userId: user.id }, data: { image: teamPhoto } })
      as(user)
      expect((await patchAccount({ image: teamPhoto, expected: { image: teamPhoto } })).status).toBe(200)
      expect((await accountOf(user.id)).image).toBe(teamPhoto)
      const [log] = await audits(user.id)
      expect(log.metadata).toMatchObject({ previous: { account: { image: google } } })
      expect(storage.removed).toEqual([]) // a Google photo is never ours to delete
    })

    it('a card without a photo shows initials on Our Team, while the author page keeps the account photo', async () => {
      const { user, card } = await contributor('GROWTH', 'j4', { image: null }, { image: ownUrl('x') })
      const account = await accountOf(user.id)
      expect((await rosterEntry(card.id))?.image).toBeNull()
      expect((await authorPage(user.id)).image).toBe(account.image)
      expect((await editorValues(user.id)).accountDiffers).toEqual({ image: account.image })
    })
  })
})
