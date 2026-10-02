/**
 * Team profiles against a REAL Postgres: the API routes, Prisma, the unique index
 * and the foreign key are all real. Auth and Supabase Storage are faked at their
 * module boundaries.
 *
 * The database is whatever vitest.config.ts resolved through the central guard
 * (scripts/lib/assertSafeTestDatabaseHost.ts): TEST_DATABASE_URL or the local default, never
 * .env.local. If it is unreachable, or its schema predates `team_members.userId`,
 * the suite skips with a warning instead of failing.
 *
 *   npm run test:setup-db      # starts a local Postgres, pushes the schema, seeds
 *   npx vitest run tests/integration/team-profile-db.test.ts
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
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL') // throws, rather than skips, on an unsafe URL
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
    await client.end().catch(() => {})
  }
}

const ready = await schemaIsReady()
if (!ready) console.warn('[team-profile-db] skipped: no local test database with the team_members.userId column')
const suite = ready ? describe : describe.skip

const { state, storage } = vi.hoisted(() => ({
  state: { prisma: undefined as unknown, session: null as null | { id: string } },
  storage: {
    uploads: [] as string[],
    removed: [] as string[],
    failUpload: false,
  },
}))

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return state.prisma
  },
}))

// Same contract as the real requireVerifiedSessionUser (re-reads the user and role
// from the database), minus next-auth's cookie handling.
vi.mock('@/lib/auth', () => ({
  getVerifiedSessionUser: async (allowed?: readonly Role[]) => {
    const db = state.prisma as PrismaClient
    if (!state.session) return null
    const user = await db.user.findUnique({ where: { id: state.session.id } })
    if (!user || (allowed && !allowed.includes(user.role))) return null
    return { id: user.id, role: user.role, name: user.name, email: user.email }
  },
  requireVerifiedSessionUser: async (allowed?: readonly Role[]) => {
    const db = state.prisma as PrismaClient
    if (!state.session) {
      return { ok: false, response: NextResponse.json({ error: 'sign in' }, { status: 401 }) }
    }
    const user = await db.user.findUnique({ where: { id: state.session.id } })
    if (!user) return { ok: false, response: NextResponse.json({ error: 'gone' }, { status: 401 }) }
    if (allowed && !allowed.includes(user.role)) {
      return { ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) }
    }
    return { ok: true, user: { id: user.id, role: user.role, name: user.name, email: user.email } }
  },
}))

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
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/avatars/${path}` },
        }),
      }),
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => {}),
  roleChangedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}))

import { PUT } from '@/app/api/team-profile/route'
import { POST as signUp } from '@/app/api/auth/signup/route'
import { PATCH as editorialPatch } from '@/app/api/editorial/users/[id]/route'
import { PATCH as adminRolePatch } from '@/app/api/admin/users/[userId]/role/route'
import { POST as adminCreate } from '@/app/api/team/route'
import { PUT as adminUpdate } from '@/app/api/team/[id]/route'
import { matchLegacyCard } from '@/lib/teamProfileLegacy'
import { buildPublicRoster } from '@/lib/teamProfiles'
import { buildTeamMasthead } from '@/lib/teamHierarchy'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let db: PrismaClient
const tag = `tp-${Date.now()}`

function put(fields: Record<string, string | File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return PUT(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
}

const photo = (bytes: Uint8Array = PNG, name = 'me.png') =>
  new File([bytes as BlobPart], name, { type: 'image/png' })

async function makeUser(role: Role, label: string, extra: Partial<Prisma.UserCreateInput> = {}) {
  return db.user.create({
    data: { email: `${tag}-${label}@ed.ac.uk`, name: `Name ${label}`, role, ...extra },
  })
}

const rowsFor = (userId: string) => db.teamMember.findMany({ where: { userId } })

suite('PUT /api/team-profile (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    const host = new URL(TEST_DB!).hostname
    console.warn(`[team-profile-db] using database host: ${host}`)
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) })
    state.prisma = db
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only'
  })

  beforeEach(() => {
    state.session = null
    storage.uploads.length = 0
    storage.removed.length = 0
    storage.failUpload = false
  })

  afterAll(async () => {
    await db.teamMember.deleteMany({ where: { OR: [{ user: { email: { startsWith: tag } } }, { email: { startsWith: tag } }] } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  describe('role mapping and creation', () => {
    it.each([
      ['WRITER', 'writers'],
      ['EDITOR', 'editorial'],
      ['GROWTH', 'growth'],
    ] as const)('a %s account creates one profile, publicly listed under %s', async (role, section) => {
      const user = await makeUser(role, `map-${role}`)
      state.session = { id: user.id }

      const res = await put({ bio: '  I write things.  ' })
      expect(res.status).toBe(201)

      const rows = await rowsFor(user.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ userId: user.id, name: user.name, bio: 'I write things.' })

      const all = await db.teamMember.findMany({
        where: { isActive: true },
        include: { user: { select: { email: true, name: true, role: true, bio: true, slug: true, isActive: true, isBanned: true } } },
      })
      const roster = buildPublicRoster(all, [])
      const mine = roster.filter((m) => m.id === rows[0].id)
      expect(mine).toHaveLength(1)
      const sections = buildTeamMasthead(mine)
      expect(sections.map((s) => s.id)).toEqual([section])
    })

    it('ignores a team, role, userId, order or isActive posted by the client', async () => {
      const victim = await makeUser('EDITOR', 'forge-victim')
      const writer = await makeUser('WRITER', 'forge-writer')
      state.session = { id: writer.id }

      const res = await put({
        bio: 'hello',
        team: 'editorial',
        role: 'EDITOR',
        userId: victim.id,
        order: '-5',
        isActive: 'false',
        name: 'Somebody Else',
      })
      expect(res.status).toBe(201)

      expect(await rowsFor(victim.id)).toHaveLength(0)
      const [mine] = await rowsFor(writer.id)
      expect(mine).toMatchObject({ name: writer.name, role: '', isActive: true, order: 1000 })
      // and the account's own role is untouched
      expect((await db.user.findUniqueOrThrow({ where: { id: writer.id } })).role).toBe('WRITER')
    })
  })

  describe('who may create one', () => {
    it.each(['ADMIN', 'READER'] as const)('refuses a %s account and creates nothing', async (role) => {
      const user = await makeUser(role, `deny-${role}`)
      state.session = { id: user.id }
      expect((await put({ bio: 'x' })).status).toBe(403)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })

    it('refuses an unauthenticated caller', async () => {
      state.session = null
      const before = await db.teamMember.count()
      expect((await put({ bio: 'x' })).status).toBe(401)
      expect(await db.teamMember.count()).toBe(before)
    })

    it('refuses an account with no name rather than inventing one', async () => {
      const user = await makeUser('WRITER', 'noname', { name: null })
      state.session = { id: user.id }
      const res = await put({ bio: 'x' })
      expect(res.status).toBe(400)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })
  })

  describe('duplicate prevention', () => {
    it('the database itself rejects a second row for the same account', async () => {
      const user = await makeUser('WRITER', 'constraint')
      await db.teamMember.create({ data: { userId: user.id, name: 'A', role: '' } })
      await expect(
        db.teamMember.create({ data: { userId: user.id, name: 'B', role: '' } }),
      ).rejects.toMatchObject({ code: 'P2002' })
      expect(await rowsFor(user.id)).toHaveLength(1)
    })

    it('still allows any number of legacy cards with no account', async () => {
      await db.teamMember.createMany({
        data: [
          { name: `${tag} legacy 1`, role: 'Writer' },
          { name: `${tag} legacy 2`, role: 'Writer' },
        ],
      })
      expect(await db.teamMember.count({ where: { name: { startsWith: `${tag} legacy` } } })).toBe(2)
      await db.teamMember.deleteMany({ where: { name: { startsWith: `${tag} legacy` } } })
    })

    it('20 simultaneous creates (double-click, two tabs, retries) leave exactly one row', async () => {
      const user = await makeUser('GROWTH', 'race')
      state.session = { id: user.id }

      const results = await Promise.all(Array.from({ length: 20 }, () => put({ bio: 'same' })))
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true)
      expect(await rowsFor(user.id)).toHaveLength(1)
    })

    it('repeating an identical request is idempotent', async () => {
      const user = await makeUser('EDITOR', 'repeat')
      state.session = { id: user.id }
      expect((await put({ bio: 'one' })).status).toBe(201)
      expect((await put({ bio: 'one' })).status).toBe(200)
      expect((await put({ bio: 'one' })).status).toBe(200)
      expect(await rowsFor(user.id)).toHaveLength(1)
    })

    it('adopts a legacy card with the same email instead of duplicating the person', async () => {
      const user = await makeUser('EDITOR', 'adopt')
      const legacy = await db.teamMember.create({
        data: {
          name: 'Legacy Name',
          role: 'Senior Editor',
          bio: 'old',
          image: '/team/legacy.png',
          email: user.email.toUpperCase(),
          order: 3,
        },
      })
      state.session = { id: user.id }

      expect((await put({ bio: 'new bio' })).status).toBe(201)

      const rows = await rowsFor(user.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: legacy.id, role: 'Senior Editor', order: 3, image: '/team/legacy.png', bio: 'new bio' })
      expect(await db.teamMember.count({ where: { email: { equals: user.email, mode: 'insensitive' } } })).toBe(1)
    })

    it('refuses to create a second card when two legacy cards share the account email', async () => {
      const user = await makeUser('WRITER', 'ambiguous')
      await db.teamMember.createMany({
        data: [
          { name: 'Dup 1', role: 'Writer', email: user.email },
          { name: 'Dup 2', role: 'Writer', email: user.email },
        ],
      })
      state.session = { id: user.id }
      const res = await put({ bio: 'x' })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('LEGACY_CARD_NEEDS_LINK')
      expect(await rowsFor(user.id)).toHaveLength(0)
    })
  })

  describe('existing members with a legacy card that has NO email (the production case)', () => {
    const legacyCard = (name: string) =>
      db.teamMember.create({
        data: { name, role: 'Senior Editor', bio: 'Admin bio', image: '/team/x.png', order: 5, email: null },
      })

    it('cannot create a second card: the request is refused and nothing is written', async () => {
      const user = await makeUser('EDITOR', 'nullmail', { name: `${tag} Nullmail Person` })
      const card = await legacyCard(`${tag} Nullmail Person`)
      state.session = { id: user.id }

      const res = await put({ bio: 'my new bio' })

      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('LEGACY_CARD_NEEDS_LINK')
      expect(await rowsFor(user.id)).toHaveLength(0)
      expect(await db.teamMember.count({ where: { name: card.name } })).toBe(1)
      expect(await db.teamMember.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ userId: null, bio: 'Admin bio' })
    })

    it('matches the name ignoring case, spacing and Unicode form', async () => {
      const user = await makeUser('EDITOR', 'casing', { name: `  ${tag.toUpperCase()}   Casing   Person ` })
      await legacyCard(`${tag} casing person`)
      state.session = { id: user.id }
      expect((await put({ bio: 'x' })).status).toBe(409)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })

    it('renaming your own account to someone else’s name never lets you take their card', async () => {
      const attacker = await makeUser('WRITER', 'hijack', { name: 'Original Name' })
      const card = await legacyCard(`${tag} Somebody Else`)
      await db.user.update({ where: { id: attacker.id }, data: { name: `${tag} Somebody Else` } })
      state.session = { id: attacker.id }

      expect((await put({ bio: 'mine now' })).status).toBe(409)

      expect(await db.teamMember.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ userId: null, bio: 'Admin bio' })
      expect(await rowsFor(attacker.id)).toHaveLength(0)
    })

    it('once an admin links the card, their first save edits that card and keeps its title, order and photo', async () => {
      const admin = await makeUser('ADMIN', 'linker-admin')
      const user = await makeUser('EDITOR', 'linked-first', { name: `${tag} Linked First` })
      const card = await legacyCard(`${tag} Linked First`)

      state.session = { id: admin.id }
      const linked = await adminUpdate(
        new NextRequest(`http://localhost/api/team/${card.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: card.name, role: card.role, bio: card.bio, image: card.image, order: card.order, userId: user.id }),
        }),
        { params: Promise.resolve({ id: card.id }) },
      )
      expect(linked.status).toBe(200)

      state.session = { id: user.id }
      expect((await put({ bio: 'my own words' })).status).toBe(200)

      const rows = await rowsFor(user.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: card.id, role: 'Senior Editor', order: 5, image: '/team/x.png', bio: 'my own words' })
      expect(await db.teamMember.count({ where: { name: card.name } })).toBe(1)
    })

    it('matchLegacyCard: adoptable by a unique email, blocked by name or ambiguity, otherwise none', async () => {
      const byEmail = await makeUser('WRITER', 'm-email', { name: `${tag} Different Name` })
      const target = await db.teamMember.create({ data: { name: 'Whoever', role: 'Writer', email: byEmail.email } })
      expect(await matchLegacyCard(db, { name: byEmail.name!, email: byEmail.email })).toMatchObject({ kind: 'adoptable', card: { id: target.id } })

      expect(await matchLegacyCard(db, { name: `${tag} Nobody At All`, email: `${tag}-nobody@ed.ac.uk` })).toEqual({ kind: 'none' })
    })
  })

  describe('admin linking (POST/PUT /api/team)', () => {
    const asAdmin = async (label: string) => {
      const admin = await makeUser('ADMIN', label)
      state.session = { id: admin.id }
      return admin
    }
    const update = (id: string, body: Record<string, unknown>) =>
      adminUpdate(
        new NextRequest(`http://localhost/api/team/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'N', ...body }) }),
        { params: Promise.resolve({ id }) },
      )

    it('links, leaves the link alone when userId is absent, and unlinks on null', async () => {
      await asAdmin('adm-1')
      const user = await makeUser('WRITER', 'adm-target')
      const card = await db.teamMember.create({ data: { name: `${tag} adm`, role: 'Writer' } })

      expect((await update(card.id, { userId: user.id })).status).toBe(200)
      expect((await rowsFor(user.id))).toHaveLength(1)
      expect((await update(card.id, { bio: 'edited by admin' })).status).toBe(200)
      expect(await rowsFor(user.id)).toHaveLength(1)
      expect((await update(card.id, { userId: null })).status).toBe(200)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })

    it('refuses to link a second card to an account that already has one (409)', async () => {
      await asAdmin('adm-2')
      const user = await makeUser('WRITER', 'adm-dup')
      await db.teamMember.create({ data: { userId: user.id, name: 'first', role: '' } })
      const other = await db.teamMember.create({ data: { name: `${tag} other`, role: 'Writer' } })
      expect((await update(other.id, { userId: user.id })).status).toBe(409)
      expect(await rowsFor(user.id)).toHaveLength(1)
    })

    it('only accepts Writer, Editor or Growth accounts: admin, reader, unknown, inactive and banned are refused (400)', async () => {
      await asAdmin('adm-3')
      const card = await db.teamMember.create({ data: { name: `${tag} adm3`, role: 'Writer' } })
      const targets = [
        await makeUser('ADMIN', 'adm-t-admin'),
        await makeUser('READER', 'adm-t-reader'),
        await makeUser('WRITER', 'adm-t-inactive', { isActive: false }),
        await makeUser('EDITOR', 'adm-t-banned', { isBanned: true }),
      ]
      for (const target of targets) {
        expect((await update(card.id, { userId: target.id })).status, target.email).toBe(400)
        expect(await rowsFor(target.id)).toHaveLength(0)
      }
      expect((await update(card.id, { userId: 'no-such-user' })).status).toBe(400)
      expect((await update(card.id, { userId: 123 })).status).toBe(400)
      expect((await db.teamMember.findUniqueOrThrow({ where: { id: card.id } })).userId).toBeNull()
    })

    it.each([
      ['WRITER', 'writers'],
      ['EDITOR', 'editorial'],
      ['GROWTH', 'growth'],
    ] as const)('a linked %s card is in %s whatever team or title the admin request carries', async (role, section) => {
      await asAdmin(`adm-team-${role}`)
      const target = await makeUser(role, `adm-team-t-${role}`)
      const card = await db.teamMember.create({ data: { name: `${tag} team ${role}`, role: 'Writer' } })
      // Titles from every other team, plus attempts to name a team or role directly.
      for (const title of ['Editor-in-Chief', 'Chief Designer', 'Head of Growth', 'Senior Editor', 'Writer', 'Social Media']) {
        const res = await update(card.id, { userId: target.id, role: title, team: 'growth', userRole: 'ADMIN', section: 'masthead' })
        expect(res.status).toBe(200)
        const rows = await db.teamMember.findMany({
          where: { id: card.id },
          include: { user: { select: { email: true, name: true, role: true, bio: true, slug: true, isActive: true, isBanned: true } } },
        })
        const sections = buildTeamMasthead(buildPublicRoster(rows, []))
        expect(sections.map((x) => x.id), title).toEqual([section])
        expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe(role)
      }
    })

    it('one account can never own two cards, through either admin route (409)', async () => {
      await asAdmin('adm-2b')
      const user = await makeUser('GROWTH', 'adm-2b-target')
      const first = await adminCreate(
        new NextRequest('http://localhost/api/team', { method: 'POST', body: JSON.stringify({ name: 'First', userId: user.id }) }),
      )
      expect(first.status).toBe(201)
      const second = await adminCreate(
        new NextRequest('http://localhost/api/team', { method: 'POST', body: JSON.stringify({ name: 'Second', userId: user.id }) }),
      )
      expect(second.status).toBe(409)
      const other = await db.teamMember.create({ data: { name: `${tag} adm2b other`, role: 'Writer' } })
      expect((await update(other.id, { userId: user.id })).status).toBe(409)
      expect(await rowsFor(user.id)).toHaveLength(1)
    })

    it('POST refuses an admin or reader target too', async () => {
      await asAdmin('adm-post')
      const reader = await makeUser('READER', 'adm-post-reader')
      const res = await adminCreate(
        new NextRequest('http://localhost/api/team', { method: 'POST', body: JSON.stringify({ name: 'X', userId: reader.id }) }),
      )
      expect(res.status).toBe(400)
      expect(await rowsFor(reader.id)).toHaveLength(0)
    })

    it('is admin-only: an editor and an anonymous caller are refused', async () => {
      const editor = await makeUser('EDITOR', 'adm-editor')
      const victim = await makeUser('WRITER', 'adm-victim')
      const card = await db.teamMember.create({ data: { name: `${tag} adm4`, role: 'Writer' } })
      for (const session of [{ id: editor.id }, null]) {
        state.session = session
        expect((await update(card.id, { userId: victim.id })).status).toBe(401)
        const created = await adminCreate(
          new NextRequest('http://localhost/api/team', { method: 'POST', body: JSON.stringify({ name: 'x', userId: victim.id }) }),
        )
        expect(created.status).toBe(401)
      }
      expect(await rowsFor(victim.id)).toHaveLength(0)
    })
  })


  describe('account lifecycle: sign-up → promotion → profile → role changes', () => {
    const create = async (name: string, label: string) => {
      const res = await signUp(
        new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email: `${tag}-life-${label}@ed.ac.uk`, password: 'password123', agreed: true }),
        }),
      )
      expect(res.status).toBe(201)
      return (await res.json()).id as string
    }

    /** The normal admin workflow: an ADMIN changes the role through the editorial users API. */
    const grant = async (userId: string, role: Role, via: 'editorial' | 'admin' = 'editorial') => {
      const admin = await db.user.findFirstOrThrow({ where: { email: `${tag}-life-admin@ed.ac.uk` } })
      const previous = state.session
      state.session = { id: admin.id }
      const res =
        via === 'editorial'
          ? await editorialPatch(
              new NextRequest(`http://localhost/api/editorial/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
              { params: Promise.resolve({ id: userId }) },
            )
          : await adminRolePatch(
              new NextRequest(`http://localhost/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
              { params: Promise.resolve({ userId }) },
            )
      state.session = previous
      expect(res.status, `grant ${role} via ${via}`).toBe(200)
    }

    /** Which public sections this account's card renders in (empty = hidden). */
    const publicSections = async (userId: string) => {
      const rows = await db.teamMember.findMany({
        where: { userId },
        include: { user: { select: { email: true, name: true, role: true, bio: true, slug: true, isActive: true, isBanned: true } } },
      })
      return buildTeamMasthead(buildPublicRoster(rows, [])).map((x) => x.id)
    }

    beforeAll(async () => {
      await db.user.create({ data: { email: `${tag}-life-admin@ed.ac.uk`, name: 'Life Admin', role: 'ADMIN' } })
    })

    it('a new sign-up is a READER: no Team Profile, and the API refuses it', async () => {
      const id = await create('Lifecycle Reader', 'reader')
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('READER')

      state.session = { id }
      const res = await put({ bio: 'let me in' })
      expect(res.status).toBe(403)
      expect(await rowsFor(id)).toHaveLength(0)
    })

    it('a reader cannot promote themselves, by any route', async () => {
      const id = await create('Lifecycle Selfish', 'selfish')
      state.session = { id }
      const viaEditorial = await editorialPatch(
        new NextRequest(`http://localhost/api/editorial/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: 'WRITER' }) }),
        { params: Promise.resolve({ id }) },
      )
      const viaAdmin = await adminRolePatch(
        new NextRequest(`http://localhost/api/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role: 'WRITER' }) }),
        { params: Promise.resolve({ userId: id }) },
      )
      expect([viaEditorial.status, viaAdmin.status]).toEqual([403, 403])
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('READER')
      expect((await put({ bio: 'x' })).status).toBe(403)
    })

    it.each([
      ['WRITER', 'writers', 'editorial'],
      ['EDITOR', 'editorial', 'editorial'],
      ['GROWTH', 'growth', 'admin'],
    ] as const)('sign up → admin grants %s → member creates their own profile in %s, with no manual step', async (role, section, via) => {
      const id = await create(`Lifecycle ${role}`, `new-${role}`)
      // nothing exists for them yet: no card, no team, nobody created one for them
      expect(await rowsFor(id)).toHaveLength(0)

      await grant(id, role, via)
      state.session = { id } // the SAME account, no new sign-in: the server reads the role from the database

      const res = await put({ bio: 'my first bio', image: photo() })
      expect(res.status).toBe(201)
      const rows = await rowsFor(id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ userId: id, bio: 'my first bio', name: `Lifecycle ${role}` })
      expect(await publicSections(id)).toEqual([section])
      // repeating changes nothing structural
      expect((await put({ bio: 'edited' })).status).toBe(200)
      expect((await rowsFor(id)).map((r) => r.id)).toEqual([rows[0].id])
    })

    it('role changes keep the same card: Writer → Editor → Growth → Reader → Writer → Admin → Editor', async () => {
      const id = await create('Lifecycle Chain', 'chain')
      await grant(id, 'WRITER')
      state.session = { id }
      expect((await put({ bio: 'chain bio', image: photo() })).status).toBe(201)
      const [original] = await rowsFor(id)
      expect(original.image).toBeTruthy()
      const unchanged = async () => {
        const rows = await rowsFor(id)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ id: original.id, userId: id, bio: 'chain bio', image: original.image })
      }

      expect(await publicSections(id)).toEqual(['writers'])

      await grant(id, 'EDITOR')
      await unchanged()
      expect(await publicSections(id)).toEqual(['editorial'])
      expect((await put({ bio: 'chain bio' })).status).toBe(200) // still editable
      await unchanged()

      await grant(id, 'GROWTH')
      await unchanged()
      expect(await publicSections(id)).toEqual(['growth'])

      // → READER: the row stays, but it is hidden and every write is refused
      await grant(id, 'READER')
      await unchanged()
      expect(await publicSections(id)).toEqual([])
      expect((await put({ bio: 'sneaky edit' })).status).toBe(403)
      expect((await put({ removeImage: 'true' })).status).toBe(403)
      expect((await put({ image: photo() })).status).toBe(403)
      await unchanged()
      expect(storage.uploads).toHaveLength(1) // the refused attempt never reached storage

      // → WRITER again: the SAME card is live again, with its bio and photo
      await grant(id, 'WRITER')
      await unchanged()
      expect(await publicSections(id)).toEqual(['writers'])
      expect((await put({ bio: 'chain bio' })).status).toBe(200)
      await unchanged()

      // → ADMIN: no team role, so no public card and no writes (same rule as every admin)
      await grant(id, 'ADMIN')
      await unchanged()
      expect(await publicSections(id)).toEqual([])
      expect((await put({ bio: 'admin edit' })).status).toBe(403)
      await unchanged()

      // → EDITOR: back, still one card
      await grant(id, 'EDITOR')
      await unchanged()
      expect(await publicSections(id)).toEqual(['editorial'])
      expect(await db.teamMember.count({ where: { name: 'Lifecycle Chain' } })).toBe(1)
    })
  })

  describe('public roster', () => {
    it('never lists an internal test account, even with a card', async () => {
      const user = await makeUser('WRITER', 'x', { email: `test-${tag}-writer@ed.ac.uk`, name: 'Test Writer' })
      state.session = { id: user.id }
      expect((await put({ bio: 'x' })).status).toBe(201)
      const rows = await db.teamMember.findMany({
        where: { userId: user.id },
        include: { user: { select: { email: true, name: true, role: true, bio: true, slug: true, isActive: true, isBanned: true } } },
      })
      expect(buildPublicRoster(rows, [])).toHaveLength(0)
      await db.teamMember.deleteMany({ where: { userId: user.id } })
      await db.user.delete({ where: { id: user.id } })
    })
  })

  describe('editing', () => {
    it('updates the description in place and shows the change publicly', async () => {
      const user = await makeUser('WRITER', 'edit')
      state.session = { id: user.id }
      await put({ bio: 'first' })
      const [before] = await rowsFor(user.id)

      expect((await put({ bio: 'second' })).status).toBe(200)

      const rows = await rowsFor(user.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(before.id)
      expect(rows[0].bio).toBe('second')
    })

    it('leaves the description alone when the field is absent, clears it when empty', async () => {
      const user = await makeUser('WRITER', 'bio-absent')
      state.session = { id: user.id }
      await put({ bio: 'keep me' })
      await put({})
      expect((await rowsFor(user.id))[0].bio).toBe('keep me')
      await put({ bio: '' })
      expect((await rowsFor(user.id))[0].bio).toBeNull()
    })

    it('rejects an over-long description and stores nothing', async () => {
      const user = await makeUser('WRITER', 'long')
      state.session = { id: user.id }
      expect((await put({ bio: 'a'.repeat(601) })).status).toBe(400)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })

    it('stores markup as plain text', async () => {
      const user = await makeUser('WRITER', 'xss')
      state.session = { id: user.id }
      await put({ bio: '<script>alert(1)</script>' })
      expect((await rowsFor(user.id))[0].bio).toBe('<script>alert(1)</script>')
    })
  })

  describe('authorisation between accounts', () => {
    it('user A’s request never touches user B’s profile or photo', async () => {
      const a = await makeUser('WRITER', 'iso-a')
      const b = await makeUser('WRITER', 'iso-b')
      state.session = { id: b.id }
      await put({ bio: 'B bio', image: photo() })
      const [bBefore] = await rowsFor(b.id)
      expect(bBefore.image).toContain(`/${b.id}/`)

      state.session = { id: a.id }
      await put({ bio: 'A bio', removeImage: 'true', userId: b.id, id: bBefore.id })

      const [bAfter] = await rowsFor(b.id)
      expect(bAfter).toMatchObject({ bio: 'B bio', image: bBefore.image })
      expect(storage.removed.some((p) => p.startsWith(`${b.id}/`))).toBe(false)
      expect((await rowsFor(a.id))[0].bio).toBe('A bio')
    })

    it('cannot delete a file in another user’s folder, even if the row says so', async () => {
      const a = await makeUser('WRITER', 'steal-a')
      const b = await makeUser('WRITER', 'steal-b')
      // A's row (as if tampered with at the database) points at B's file.
      await db.teamMember.create({
        data: {
          userId: a.id,
          name: 'A',
          role: '',
          image: `https://test.supabase.co/storage/v1/object/public/avatars/${b.id}/theirs.png`,
        },
      })
      state.session = { id: a.id }
      await put({ removeImage: 'true' })
      expect(storage.removed).toEqual([])
    })

    it('demoting an account removes its card from the public roster; the team follows the role', async () => {
      const user = await makeUser('WRITER', 'demote')
      state.session = { id: user.id }
      await put({ bio: 'x' })

      const load = async () =>
        buildPublicRoster(
          await db.teamMember.findMany({
            where: { userId: user.id },
            include: { user: { select: { email: true, name: true, role: true, bio: true, slug: true, isActive: true, isBanned: true } } },
          }),
          [],
        )

      expect((await load())[0].team).toBe('writing')
      await db.user.update({ where: { id: user.id }, data: { role: 'EDITOR' } })
      expect((await load())[0].team).toBe('editorial')
      await db.user.update({ where: { id: user.id }, data: { role: 'READER' } })
      expect(await load()).toHaveLength(0)
      // …and the same request now fails closed.
      expect((await put({ bio: 'y' })).status).toBe(403)
    })

    it('deleting an account removes its card', async () => {
      const user = await makeUser('WRITER', 'cascade')
      state.session = { id: user.id }
      await put({ bio: 'x' })
      await db.user.delete({ where: { id: user.id } })
      expect(await rowsFor(user.id)).toHaveLength(0)
    })
  })

  describe('photos', () => {
    it('uploads into the caller’s own folder and stores the URL', async () => {
      const user = await makeUser('WRITER', 'photo')
      state.session = { id: user.id }
      expect((await put({ image: photo() })).status).toBe(201)
      expect(storage.uploads).toHaveLength(1)
      expect(storage.uploads[0]).toMatch(new RegExp(`^${user.id}/team-.*\\.png$`))
      expect((await rowsFor(user.id))[0].image).toContain(storage.uploads[0])
    })

    it('replacing a photo stores the new one and removes only the old one', async () => {
      const user = await makeUser('WRITER', 'replace')
      state.session = { id: user.id }
      await put({ image: photo() })
      const [first] = await rowsFor(user.id)

      await put({ image: photo(PNG, 'second.png') })

      const rows = await rowsFor(user.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].image).not.toBe(first.image)
      expect(storage.removed).toEqual([storage.uploads[0]])
    })

    it('removing a photo clears it and deletes the file', async () => {
      const user = await makeUser('WRITER', 'remove')
      state.session = { id: user.id }
      await put({ image: photo() })
      await put({ removeImage: 'true' })
      expect((await rowsFor(user.id))[0].image).toBeNull()
      expect(storage.removed).toHaveLength(1)
    })

    it('never deletes a legacy /team/*.png file when replaced', async () => {
      const user = await makeUser('WRITER', 'legacy-img')
      await db.teamMember.create({ data: { userId: user.id, name: 'x', role: '', image: '/team/old.png' } })
      state.session = { id: user.id }
      await put({ image: photo() })
      expect(storage.removed).toEqual([])
    })

    it('rejects a file that is not an image, whatever its name or declared type', async () => {
      const user = await makeUser('WRITER', 'badtype')
      state.session = { id: user.id }
      const fake = new File([new TextEncoder().encode('<svg onload=alert(1)>')], 'me.png', { type: 'image/png' })
      const res = await put({ bio: 'x', image: fake })
      expect(res.status).toBe(400)
      expect(storage.uploads).toHaveLength(0)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })

    it('rejects an oversized image before uploading', async () => {
      const user = await makeUser('WRITER', 'big')
      state.session = { id: user.id }
      const big = new Uint8Array(4 * 1024 * 1024 + 1)
      big.set(PNG)
      const res = await put({ image: photo(big) })
      expect(res.status).toBe(400)
      expect(storage.uploads).toHaveLength(0)
      expect(await rowsFor(user.id)).toHaveLength(0)
    })

    it('a failed upload changes nothing', async () => {
      const user = await makeUser('WRITER', 'upfail')
      state.session = { id: user.id }
      await put({ bio: 'original' })
      storage.failUpload = true

      const res = await put({ bio: 'changed', image: photo() })
      expect(res.status).toBe(502)
      const [row] = await rowsFor(user.id)
      expect(row).toMatchObject({ bio: 'original', image: null })
    })

    it('if the database write fails after the upload, the new file is removed and the old photo kept', async () => {
      const user = await makeUser('WRITER', 'dbfail')
      state.session = { id: user.id }
      await put({ image: photo() })
      const [before] = await rowsFor(user.id)
      const uploadedBefore = [...storage.uploads]

      const spy = vi.spyOn(db.teamMember, 'upsert').mockRejectedValueOnce(new Error('db down'))
      const res = await put({ bio: 'new', image: photo(PNG, 'b.png') })
      spy.mockRestore()

      expect(res.status).toBeGreaterThanOrEqual(500)
      expect((await rowsFor(user.id))[0]).toMatchObject({ image: before.image, bio: null })
      const newUpload = storage.uploads.find((p) => !uploadedBefore.includes(p))!
      expect(storage.removed).toEqual([newUpload])
    })
  })
})
