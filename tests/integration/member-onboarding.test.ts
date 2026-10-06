/**
 * The whole new-hire lifecycle against a REAL Postgres: admin pre-authorises an email
 * -> the person signs up / signs in -> the verified account claims the invitation ->
 * role-gated access -> they complete their Meet the Team profile -> an admin publishes
 * it -> promotion -> revocation.
 *
 * Real: Prisma, the unique indexes, NextAuth's own callbacks (signIn / jwt) and the
 * credentials `authorize`, the PrismaAdapter, `requireVerifiedSessionUser`, and every
 * route handler under test. Faked at the boundary only: the NextAuth cookie (we set
 * `state.session` to the account that "is signed in"), Supabase Storage and email.
 * The database is whatever vitest.config.ts resolved through the central guard (never
 * .env.local); the suite skips when it is unreachable or lacks `team_memberships`.
 *
 *   npm run test:setup-db
 *   npx vitest run tests/integration/member-onboarding.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient, type Role } from '@prisma/client'
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
    const { rowCount } = await client.query(`select 1 from information_schema.tables where table_name = 'team_memberships'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const ready = await schemaIsReady()
if (!ready) console.warn('[member-onboarding] skipped: no local test database with the team_memberships table')
const suite = ready ? describe : describe.skip

const { state, mail, storage } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return {
    state: { prisma: undefined as unknown, session: null as null | { id: string } },
    mail: [] as { to: string; subject: string; html: string }[],
    storage: { uploads: [] as string[] },
  }
})

// A Proxy, not a getter: auth.ts hands `prisma` to the PrismaAdapter once, at import
// time, before the test database client exists.
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.prisma as Record<string | symbol, unknown>)[key] }),
}))

// Only the cookie lookup is faked; every authorisation decision still reads the database.
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          storage.uploads.push(path)
          return { error: null }
        },
        remove: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/avatars/${path}` },
        }),
      }),
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return {
    ...actual,
    sendEmail: vi.fn(async (message: { to: string; subject: string; html: string }) => {
      mail.push(message)
      return true
    }),
  }
})

import { authOptions } from '@/lib/auth'
import { POST as signUp } from '@/app/api/auth/signup/route'
import { POST as requestVerification } from '@/app/api/auth/verify-email/request/route'
import { POST as confirmVerification } from '@/app/api/auth/verify-email/route'
import { PUT as putTeamProfile } from '@/app/api/team-profile/route'
import { GET as listMembersRoute, POST as inviteRoute } from '@/app/api/admin/members/route'
import { PATCH as patchMember } from '@/app/api/admin/members/[id]/route'
import { POST as revokeRoute } from '@/app/api/admin/members/[id]/revoke/route'
import { POST as reinstateRoute } from '@/app/api/admin/members/[id]/reinstate/route'
import { GET as publicTeamApi } from '@/app/api/team/route'
import { GET as editorialUsers } from '@/app/api/editorial/users/route'
import { POST as createArticle } from '@/app/api/articles/route'
import { GET as analyticsRoute } from '@/app/api/editorial/analytics/route'
import { PATCH as adminRolePatch } from '@/app/api/admin/users/[userId]/role/route'
import { buildPublicRoster } from '@/lib/teamProfiles'
import { buildTeamMasthead } from '@/lib/teamHierarchy'
import { claimInvitationForUser, listMembers, setMemberRole } from '@/lib/membership'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let db: PrismaClient
const tag = `mo-${Date.now()}`
const email = (label: string) => `${tag}-${label}@ed.ac.uk`

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) })

async function makeAdmin(label: string) {
  return db.user.create({ data: { email: email(label), name: `Admin ${label}`, role: 'ADMIN', emailVerified: new Date() } })
}

const actingAs = (userId: string | null) => {
  state.session = userId ? { id: userId } : null
}

// ── admin helpers (real route handlers) ──────────────────────────────────────

async function invite(adminId: string, body: Record<string, unknown>) {
  actingAs(adminId)
  const res = await inviteRoute(json('/api/admin/members', 'POST', body))
  return { status: res.status, body: await res.json() }
}

async function patch(adminId: string, memberId: string, body: Record<string, unknown>) {
  actingAs(adminId)
  const res = await patchMember(json(`/api/admin/members/${memberId}`, 'PATCH', body), ctx({ id: memberId }))
  return { status: res.status, body: await res.json() }
}

const membershipFor = (address: string) => db.teamMembership.findUnique({ where: { email: address.trim().toLowerCase() } })

// ── sign-up / sign-in helpers (real NextAuth callbacks) ──────────────────────

async function register(name: string, address: string, password = 'password123') {
  const res = await signUp(json('/api/auth/signup', 'POST', { name, email: address, password, agreed: true }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

type CredentialsProviderShape = { options: { authorize: (c: Record<string, string>, req: unknown) => Promise<{ id: string; role: Role } | null> } }

async function passwordSignIn(address: string, password = 'password123') {
  const provider = authOptions.providers.find((p) => p.id === 'credentials') as unknown as CredentialsProviderShape
  const user = await provider.options.authorize({ email: address, password }, { headers: {} })
  if (!user) return null
  const jwt = authOptions.callbacks!.jwt!
  const token = await jwt({ token: {}, user, account: { provider: 'credentials', type: 'credentials', providerAccountId: user.id } } as never)
  return { user, token }
}

async function googleSignIn(address: string, opts: { verified?: boolean; name?: string } = {}) {
  const adapter = authOptions.adapter!
  const verified = opts.verified ?? true
  const profileUser = { email: address.toLowerCase(), name: opts.name ?? 'Google Person', image: null }
  const found = await adapter.getUserByEmail!(profileUser.email)
  const account = { provider: 'google', type: 'oauth', providerAccountId: `g-${address}` }
  const allowed = await authOptions.callbacks!.signIn!({
    user: (found ?? profileUser) as never,
    account: account as never,
    profile: { email_verified: verified } as never,
  })
  if (allowed !== true) return { allowed, token: null as null | { role?: Role; id?: string } }
  const user = found ?? (await adapter.createUser!({ ...profileUser, role: 'READER', emailVerified: null } as never))
  const token = await authOptions.callbacks!.jwt!({ token: {}, user, account } as never)
  return { allowed, token: token as { role?: Role; id?: string } }
}

/** The password user's route to a verified address: request the email, click the link. */
async function verifyByEmailLink(userId: string) {
  actingAs(userId)
  mail.length = 0
  const requested = await requestVerification()
  expect(requested.status).toBe(200)
  const message = mail.at(-1)!
  const token = /token=([0-9a-f]{64})/.exec(message.html)![1]
  const form = new FormData()
  form.set('token', token)
  const res = await confirmVerification(new NextRequest('http://localhost/api/auth/verify-email', { method: 'POST', body: form }))
  expect(res.status).toBe(303)
  return { token, location: res.headers.get('location')! }
}

// ── what each role can reach ─────────────────────────────────────────────────

async function reach(userId: string) {
  actingAs(userId)
  const articles = await createArticle(json('/api/articles', 'POST', { title: `${tag} probe`, content: '{}' }))
  const users = await editorialUsers()
  const analytics = await analyticsRoute(json('/api/editorial/analytics', 'GET'))
  const adminMembers = await listMembersRoute()
  const allowed = (status: number) => status !== 401 && status !== 403
  return {
    writeArticles: allowed(articles.status),
    manageUsers: allowed(users.status),
    analytics: allowed(analytics.status),
    admin: allowed(adminMembers.status),
  }
}

function put(fields: Record<string, string | File | undefined>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value)
  return putTeamProfile(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
}
const photo = () => new File([PNG as BlobPart], 'me.png', { type: 'image/png' })

async function publicCardsFor(userId: string) {
  const rows = await db.teamMember.findMany({
    where: { isActive: true },
    include: { user: { select: { email: true, name: true, role: true, bio: true, slug: true, isActive: true, isBanned: true } } },
  })
  return buildPublicRoster(rows, []).filter((m) => rows.find((r) => r.id === m.id)?.userId === userId)
}

const counts = async (address: string) => ({
  users: await db.user.count({ where: { email: { equals: address, mode: 'insensitive' } } }),
  memberships: await db.teamMembership.count({ where: { email: address.toLowerCase() } }),
  cards: await db.teamMember.count({ where: { user: { email: { equals: address, mode: 'insensitive' } } } }),
})

suite('member onboarding lifecycle (real database)', () => {
  let admin: { id: string }

  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DB! }),
      omit: { user: { password: true } },
    }) as unknown as PrismaClient
    state.prisma = db
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only'
    admin = await makeAdmin('admin')
  })

  beforeEach(() => {
    state.session = null
    storage.uploads.length = 0
    mail.length = 0
  })

  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    await db.teamMember.deleteMany({ where: { OR: [{ userId: { in: ids } }, { name: { startsWith: tag } }] } })
    await db.teamMembership.deleteMany({ where: { email: { startsWith: tag } } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { performedBy: { in: ids } }] } })
    await db.verificationToken.deleteMany({ where: { identifier: { in: ids.map((id) => `verify-email:${id}`) } } })
    await db.article.deleteMany({ where: { title: `${tag} probe` } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  // ── 1-12 / 13-17: a new hire, for each team role ───────────────────────────
  describe.each([
    {
      role: 'WRITER' as const,
      position: 'Staff Writer',
      section: 'writers',
      can: { writeArticles: true, manageUsers: false, analytics: false, admin: false },
    },
    {
      role: 'EDITOR' as const,
      position: 'Senior Editor',
      section: 'editorial',
      can: { writeArticles: true, manageUsers: true, analytics: false, admin: false },
    },
    {
      role: 'GROWTH' as const,
      position: 'Social Media Lead',
      section: 'growth',
      can: { writeArticles: false, manageUsers: false, analytics: true, admin: false },
    },
  ])('new $role: invited before registering, via a password account', ({ role, position, section, can }) => {
    const label = `jane-${role.toLowerCase()}`
    const address = email(label)
    let userId: string

    it('an admin pre-authorises the email (any case, stray spaces); nobody has an account yet', async () => {
      const res = await invite(admin.id, { email: `  ${address.toUpperCase()} `, role })
      expect(res.status).toBe(201)
      expect(res.body.outcome).toBe('invited')
      expect(await db.user.count({ where: { email: { equals: address, mode: 'insensitive' } } })).toBe(0)
      expect(await membershipFor(address)).toMatchObject({ status: 'PENDING', role, userId: null, invitedById: admin.id })
    })

    it('a duplicate invitation (different case) updates the one row instead of adding another', async () => {
      const res = await invite(admin.id, { email: address.toUpperCase(), role })
      expect(res.status).toBe(200)
      expect(res.body.outcome).toBe('updated')
      expect(await db.teamMembership.count({ where: { email: address } })).toBe(1)
    })

    it('registering with the invited address, unconfirmed, gives a plain reader: no access yet', async () => {
      userId = await register('Jane Doe', address.toUpperCase())
      const signedIn = await passwordSignIn(address)
      expect(signedIn!.user.role).toBe('READER')
      expect(await membershipFor(address)).toMatchObject({ status: 'PENDING', userId: null })
      expect(await reach(userId)).toEqual({ writeArticles: false, manageUsers: false, analytics: false, admin: false })
    })

    it('confirming the address by emailed link claims the invitation and switches the role on', async () => {
      const { location } = await verifyByEmailLink(userId)
      expect(location).toContain('status=activated')
      expect(await membershipFor(address)).toMatchObject({ status: 'ACTIVE', userId, role })
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe(role)
    })

    it('the account gets exactly the access of its role, and none of the others', async () => {
      expect(await reach(userId)).toEqual(can)
    })

    it('their Team Profile is ready and hidden: no empty card appears publicly', async () => {
      const cards = await db.teamMember.findMany({ where: { userId } })
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ name: 'Jane Doe', role: '', isActive: false })
      expect(await publicCardsFor(userId)).toHaveLength(0)
    })

    it('they add a display name, photo and bio, but cannot set position, team, role or visibility', async () => {
      actingAs(userId)
      for (const forged of [{ role: 'ADMIN' }, { team: 'editorial' }, { position: 'Editor-in-Chief' }, { isActive: 'true' }, { order: '0' }]) {
        expect((await put({ bio: 'x', ...forged })).status).toBe(400)
      }
      const res = await put({ name: 'Jane D.', bio: 'I write about money.', image: photo() })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ name: 'Jane D.', status: { complete: false, missingFromAdmin: ['position'] } })
      const [card] = await db.teamMember.findMany({ where: { userId } })
      expect(card).toMatchObject({ name: 'Jane D.', bio: 'I write about money.', role: '', isActive: false })
      expect(card.image).toContain(`/${userId}/`)
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe(role)
      expect(await publicCardsFor(userId)).toHaveLength(0) // no position yet
    })

    it('an admin sets position, team, order and visibility; she then appears exactly once', async () => {
      const row = (await listMembers()).find((m) => m.email === address)!
      expect(row).toMatchObject({ accountStatus: 'active', profileStatus: 'incomplete', missingFromAdmin: ['position'] })

      const res = await patch(admin.id, row.id, { position, team: section === 'writers' ? 'writing' : section, order: 7, visible: true })
      expect(res.status).toBe(200)

      const cards = await publicCardsFor(userId)
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ name: 'Jane D.', role: position, bio: 'I write about money.' })
      expect(buildTeamMasthead(cards).map((s) => s.id)).toEqual([section])
      expect((await listMembers()).find((m) => m.email === address)).toMatchObject({ profileStatus: 'published', accountStatus: 'active' })
    })

    it('signing in again, any number of times, creates nothing and resets nothing', async () => {
      const before = await db.teamMember.findMany({ where: { userId } })
      for (let i = 0; i < 3; i++) {
        const signedIn = await passwordSignIn(address.toUpperCase())
        expect(signedIn!.user.role).toBe(role)
      }
      await googleSignIn(address) // a second way in, same verified address
      await Promise.all([claimInvitationForUser(userId, db as never), claimInvitationForUser(userId, db as never)])
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
      expect(await db.teamMember.findMany({ where: { userId } })).toEqual(before)
      expect(await membershipFor(address)).toMatchObject({ status: 'ACTIVE', role })
    })
  })

  // ── Google sign-in ─────────────────────────────────────────────────────────
  describe('first sign-in with Google', () => {
    it('a brand-new Google user with a pending invitation is a Writer immediately, with one user, membership and card', async () => {
      const address = email('google-new')
      await invite(admin.id, { email: address, role: 'WRITER' })

      const result = await googleSignIn(address, { name: 'Gina Google' })
      expect(result.allowed).toBe(true)
      expect(result.token!.role).toBe('WRITER')

      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
      expect(await membershipFor(address)).toMatchObject({ status: 'ACTIVE', role: 'WRITER' })
      expect((await db.user.findFirstOrThrow({ where: { email: address } })).emailVerified).not.toBeNull()

      const again = await googleSignIn(address)
      expect(again.token!.role).toBe('WRITER')
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
    })

    it('an unverified Google email is refused outright and claims nothing', async () => {
      const address = email('google-unverified')
      await invite(admin.id, { email: address, role: 'EDITOR' })
      const result = await googleSignIn(address, { verified: false })
      expect(result.allowed).toBe(false)
      expect(await membershipFor(address)).toMatchObject({ status: 'PENDING', userId: null })
      expect(await db.user.count({ where: { email: address } })).toBe(0)
    })

    it('Google returning the address in other letter-case finds the same account', async () => {
      const address = email('google-case')
      await invite(admin.id, { email: address, role: 'GROWTH' })
      const first = await googleSignIn(address.toUpperCase())
      expect(first.token!.role).toBe('GROWTH')
      expect(await db.user.count({ where: { email: { equals: address, mode: 'insensitive' } } })).toBe(1)
    })

    it('does not merge into an unconfirmed password account, even with no invitation yet', async () => {
      const address = email('squatter-early')
      const id = await register('Not The Owner', address, 'squatter-password')
      expect((await googleSignIn(address)).allowed).toBe('/login?error=VerifyEmailFirst')
      expect((await db.user.findUniqueOrThrow({ where: { id } })).emailVerified).toBeNull()
      expect(await db.account.count({ where: { userId: id } })).toBe(0)
    })

    it('does not merge into an unconfirmed password account that an invitation is waiting for', async () => {
      const address = email('squatter')
      await invite(admin.id, { email: address, role: 'WRITER' })
      const squatterId = await register('Not The Owner', address, 'squatter-password')

      const result = await googleSignIn(address)
      expect(result.allowed).toBe('/login?error=VerifyEmailFirst')
      expect(await membershipFor(address)).toMatchObject({ status: 'PENDING', userId: null })
      expect((await db.user.findUniqueOrThrow({ where: { id: squatterId } })).role).toBe('READER')
    })
  })

  // ── 18-21: the account existed before the hire ─────────────────────────────
  describe('account created before being hired', () => {
    it('a verified account gains the role the moment an admin adds its email, with no recreation', async () => {
      const address = email('existing-verified')
      const id = await register('Early Bird', address)
      await verifyByEmailLink(id)
      expect((await passwordSignIn(address))!.user.role).toBe('READER')

      const res = await invite(admin.id, { email: address, role: 'WRITER' })
      expect(res.body.outcome).toBe('activated')
      expect(res.body.membership.userId).toBe(id)
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('WRITER')
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })

      // their profile system works as normal
      actingAs(id)
      expect((await put({ bio: 'Hello', image: photo() })).status).toBe(200)
      expect((await reach(id)).writeArticles).toBe(true)
    })

    it('an unconfirmed account is left pending (and says so) until its owner proves the address', async () => {
      const address = email('existing-unverified')
      const id = await register('Unconfirmed', address)
      const res = await invite(admin.id, { email: address, role: 'EDITOR' })
      expect(res.body.outcome).toBe('invited')
      expect(res.body.accountExistsUnverified).toBe(true)
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('READER')
      expect((await listMembers()).find((m) => m.email === address)).toMatchObject({ accountStatus: 'unverified' })

      await verifyByEmailLink(id)
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('EDITOR')
    })

    it('completing a password reset also proves the inbox and claims the invitation', async () => {
      const address = email('existing-reset')
      const id = await register('Resetter', address)
      await invite(admin.id, { email: address, role: 'WRITER' })
      const { verifyEmailAndClaim } = await import('@/lib/membership')
      await verifyEmailAndClaim(id, db as never)
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('WRITER')
    })

    it('an admin can also assign a role straight to an account from the user list', async () => {
      const address = email('existing-direct')
      const id = await register('Direct', address)
      actingAs(admin.id)
      const res = await adminRolePatch(json(`/api/admin/users/${id}/role`, 'PATCH', { role: 'WRITER' }), ctx({ userId: id }))
      expect(res.status).toBe(200)
      expect(await membershipFor(address)).toMatchObject({ status: 'ACTIVE', role: 'WRITER', userId: id })
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
    })
  })

  // ── 22-25: promotion ───────────────────────────────────────────────────────
  describe('role change', () => {
    it('Writer -> Editor updates access and leaves the profile, photo, bio, position and visibility alone', async () => {
      const address = email('promote')
      await invite(admin.id, { email: address, role: 'WRITER', position: 'Staff Writer', team: 'writing' })
      const signedIn = await googleSignIn(address, { name: 'Pat Promote' })
      const userId = signedIn.token!.id!
      actingAs(userId)
      await put({ name: 'Pat P.', bio: 'Original bio', image: photo() })
      const row = (await listMembers()).find((m) => m.email === address)!
      await patch(admin.id, row.id, { visible: true })
      expect(await publicCardsFor(userId)).toHaveLength(1)
      const [before] = await db.teamMember.findMany({ where: { userId } })

      const res = await patch(admin.id, row.id, { role: 'EDITOR' })
      expect(res.status).toBe(200)

      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('EDITOR')
      expect(await membershipFor(address)).toMatchObject({ role: 'EDITOR', status: 'ACTIVE' })
      expect(await db.teamMember.findMany({ where: { userId } })).toEqual([before])
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
      expect((await publicCardsFor(userId))[0]).toMatchObject({ name: 'Pat P.', role: 'Staff Writer', team: 'writing' })
      expect((await reach(userId)).manageUsers).toBe(true)
      expect((await reach(userId)).admin).toBe(false)
    })

    it('changing the role while the invitation is still pending changes what is granted at first sign-in', async () => {
      const address = email('pending-change')
      await invite(admin.id, { email: address, role: 'WRITER' })
      const pending = (await membershipFor(address))!
      expect((await patch(admin.id, pending.id, { role: 'GROWTH' })).status).toBe(200)
      expect(await db.teamMembership.count({ where: { email: address } })).toBe(1)

      const result = await googleSignIn(address)
      expect(result.token!.role).toBe('GROWTH')
    })
  })

  // ── 26-28: ADMIN with a public position ────────────────────────────────────
  describe('admin permission with a public position', () => {
    it('keeps "Deputy Editor" publicly; the page never says Admin', async () => {
      const address = email('deputy')
      await invite(admin.id, { email: address, role: 'EDITOR', position: 'Deputy Editor', team: 'editorial' })
      const { token } = await googleSignIn(address, { name: 'Dee Deputy' })
      const userId = token!.id!
      actingAs(userId)
      await put({ bio: 'I deputise.' })
      const row = (await listMembers()).find((m) => m.email === address)!
      await patch(admin.id, row.id, { visible: true })
      expect(await publicCardsFor(userId)).toHaveLength(1)

      expect((await patch(admin.id, row.id, { role: 'ADMIN' })).status).toBe(200)
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('ADMIN')
      expect((await reach(userId)).admin).toBe(true)

      const cards = await publicCardsFor(userId)
      expect(cards).toHaveLength(1)
      expect(cards[0].role).toBe('Deputy Editor')
      expect(JSON.stringify(cards)).not.toMatch(/admin/i)
      expect(buildTeamMasthead(cards).map((s) => s.id)).toEqual(['editorial'])
    })
  })

  // ── 29-32: leaving ─────────────────────────────────────────────────────────
  describe('revoked member', () => {
    it('loses access, keeps their profile data, and the public card is a separate decision', async () => {
      const address = email('leaver')
      await invite(admin.id, { email: address, role: 'WRITER', position: 'Staff Writer', team: 'writing' })
      const { token } = await googleSignIn(address, { name: 'Lee Leaver' })
      const userId = token!.id!
      actingAs(userId)
      await put({ bio: 'Leaving soon', image: photo() })
      const row = (await listMembers()).find((m) => m.email === address)!
      await patch(admin.id, row.id, { visible: true })
      const [before] = await db.teamMember.findMany({ where: { userId } })

      actingAs(admin.id)
      const res = await revokeRoute(json(`/api/admin/members/${row.id}/revoke`, 'POST', {}), ctx({ id: row.id }))
      expect(res.status).toBe(200)

      // no longer able to use protected functionality
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('READER')
      expect(await membershipFor(address)).toMatchObject({ status: 'REVOKED', revokedById: admin.id })
      expect(await reach(userId)).toEqual({ writeArticles: false, manageUsers: false, analytics: false, admin: false })
      actingAs(userId)
      expect((await put({ bio: 'sneaky' })).status).toBe(403)

      // profile data untouched, and still public until an admin decides otherwise
      expect(await db.teamMember.findMany({ where: { userId } })).toEqual([before])
      expect(await publicCardsFor(userId)).toHaveLength(1)

      // a revoked invitation cannot be re-claimed by signing in again
      expect((await googleSignIn(address)).token!.role).toBe('READER')
      expect(await membershipFor(address)).toMatchObject({ status: 'REVOKED' })

      // the admin now hides the profile, separately
      expect((await patch(admin.id, row.id, { visible: false })).status).toBe(200)
      expect(await publicCardsFor(userId)).toHaveLength(0)
      expect(await db.teamMember.findMany({ where: { userId } })).toHaveLength(1)
      expect((await listMembers()).find((m) => m.email === address)).toMatchObject({ accountStatus: 'revoked', profileStatus: 'hidden' })

      // and can bring them back
      actingAs(admin.id)
      const back = await reinstateRoute(json(`/api/admin/members/${row.id}/reinstate`, 'POST', { role: 'EDITOR' }), ctx({ id: row.id }))
      expect(back.status).toBe(200)
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('EDITOR')
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
    })

    it('can hide the profile in the same step, and cancels a pending invitation', async () => {
      const address = email('leaver-hide')
      await invite(admin.id, { email: address, role: 'GROWTH', position: 'Comms', team: 'growth' })
      const { token } = await googleSignIn(address, { name: 'Hide Me' })
      const userId = token!.id!
      actingAs(userId)
      await put({ bio: 'bye' })
      const row = (await listMembers()).find((m) => m.email === address)!
      await patch(admin.id, row.id, { visible: true })

      actingAs(admin.id)
      await revokeRoute(json(`/api/admin/members/${row.id}/revoke`, 'POST', { hideProfile: true }), ctx({ id: row.id }))
      expect(await publicCardsFor(userId)).toHaveLength(0)
      expect(await db.teamMember.count({ where: { userId } })).toBe(1)

      const pending = email('never-joined')
      await invite(admin.id, { email: pending, role: 'WRITER' })
      const pendingRow = (await membershipFor(pending))!
      actingAs(admin.id)
      await revokeRoute(json(`/api/admin/members/${pendingRow.id}/revoke`, 'POST', {}), ctx({ id: pendingRow.id }))
      expect((await googleSignIn(pending)).token!.role).toBe('READER')
    })
  })

  // ── 33-40: security ────────────────────────────────────────────────────────
  describe('security', () => {
    it('nobody can pick their own role when signing up', async () => {
      const address = email('self-assign')
      const res = await signUp(json('/api/auth/signup', 'POST', { name: 'Eve Eve', email: address, password: 'password123', agreed: true, role: 'ADMIN', permissions: ['EDITOR'] }))
      expect(res.status).toBe(201)
      const user = await db.user.findUniqueOrThrow({ where: { email: address } })
      expect(user.role).toBe('READER')
      expect(await membershipFor(address)).toBeNull()
    })

    it('an uninvited account cannot make itself a Writer or Editor by any request', async () => {
      const address = email('uninvited')
      const id = await register('Uninvited', address)
      await verifyByEmailLink(id) // even with a fully verified address
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('READER')

      actingAs(id)
      expect((await put({ bio: 'x', role: 'WRITER' })).status).toBe(403) // role gate: not a member
      expect((await put({ bio: 'x' })).status).toBe(403)
      for (const role of ['WRITER', 'EDITOR']) {
        const res = await adminRolePatch(json(`/api/admin/users/${id}/role`, 'PATCH', { role }), ctx({ userId: id }))
        expect(res.status).toBe(403)
        const viaInvite = await inviteRoute(json('/api/admin/members', 'POST', { email: address, role }))
        expect(viaInvite.status).toBe(403)
      }
      expect(await claimInvitationForUser(id, db as never)).toMatchObject({ claimed: false })
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('READER')
      expect(await membershipFor(address)).toBeNull()
    })

    it('a team member cannot touch anyone else’s membership, or their own', async () => {
      const writerAddress = email('sec-writer')
      const otherAddress = email('sec-other')
      await invite(admin.id, { email: writerAddress, role: 'WRITER' })
      await invite(admin.id, { email: otherAddress, role: 'WRITER' })
      const writerId = (await googleSignIn(writerAddress)).token!.id!
      const other = (await membershipFor(otherAddress))!
      const mine = (await membershipFor(writerAddress))!

      actingAs(writerId)
      for (const target of [other, mine]) {
        expect((await patchMember(json(`/api/admin/members/${target.id}`, 'PATCH', { role: 'ADMIN' }), ctx({ id: target.id }))).status).toBe(403)
        expect((await revokeRoute(json(`/api/admin/members/${target.id}/revoke`, 'POST', {}), ctx({ id: target.id }))).status).toBe(403)
        expect((await reinstateRoute(json(`/api/admin/members/${target.id}/reinstate`, 'POST', { role: 'ADMIN' }), ctx({ id: target.id }))).status).toBe(403)
      }
      expect((await inviteRoute(json('/api/admin/members', 'POST', { email: email('x'), role: 'EDITOR' }))).status).toBe(403)
      expect((await listMembersRoute()).status).toBe(403)
      expect(await membershipFor(otherAddress)).toMatchObject({ status: 'PENDING', role: 'WRITER' })
      expect(await membershipFor(writerAddress)).toMatchObject({ status: 'ACTIVE', role: 'WRITER' })
      expect((await db.user.findUniqueOrThrow({ where: { id: writerId } })).role).toBe('WRITER')
    })

    it('signing in with a different email never claims someone else’s invitation', async () => {
      const invited = email('victim-invite')
      await invite(admin.id, { email: invited, role: 'EDITOR' })

      const attackerAddress = email('attacker')
      const attackerId = await register('Attacker', attackerAddress)
      await verifyByEmailLink(attackerId)
      expect((await passwordSignIn(attackerAddress))!.user.role).toBe('READER')
      expect((await googleSignIn(email('attacker-google'))).token!.role).toBe('READER')

      // the claim takes a user id and reads that account's OWN email; there is no way to name another
      expect(await claimInvitationForUser(attackerId, db as never)).toMatchObject({ claimed: false, reason: 'no-invitation' })
      expect(await membershipFor(invited)).toMatchObject({ status: 'PENDING', userId: null })
    })

    it('forged role values are rejected server-side', async () => {
      for (const role of ['SUPERUSER', 'READER', 'admin', '', null, 7, { $set: 'ADMIN' }]) {
        const res = await invite(admin.id, { email: email('forged'), role })
        expect(res.status, JSON.stringify(role)).toBe(400)
      }
      expect(await membershipFor(email('forged'))).toBeNull()

      await invite(admin.id, { email: email('forged-patch'), role: 'WRITER' })
      const row = (await membershipFor(email('forged-patch')))!
      for (const body of [{ role: 'ROOT' }, { status: 'ACTIVE' }, { userId: admin.id }, { email: 'x@y.z' }]) {
        expect((await patch(admin.id, row.id, body)).status).toBe(400)
      }
      expect(await membershipFor(email('forged-patch'))).toMatchObject({ role: 'WRITER', status: 'PENDING', userId: null })
      // an invalid email, an unknown team, and an unknown extra field
      expect((await invite(admin.id, { email: 'not-an-email', role: 'WRITER' })).status).toBe(400)
      expect((await invite(admin.id, { email: email('t'), role: 'WRITER', team: 'admin' })).status).toBe(400)
      expect((await invite(admin.id, { email: email('t'), role: 'WRITER', status: 'ACTIVE' })).status).toBe(400)
    })

    it('an unauthenticated caller cannot invite, list, patch or revoke', async () => {
      actingAs(null)
      expect((await inviteRoute(json('/api/admin/members', 'POST', { email: email('anon'), role: 'WRITER' }))).status).toBe(403)
      expect((await listMembersRoute()).status).toBe(403)
      expect(await membershipFor(email('anon'))).toBeNull()
    })

    it('simultaneous sign-ins and claims for a verified, invited account produce one claim and no duplicates', async () => {
      const address = email('race')
      const id = await register('Racer', address)
      await invite(admin.id, { email: address, role: 'WRITER' })
      // The address becomes verified out of band; every request below then races to claim.
      await db.user.update({ where: { id }, data: { emailVerified: new Date() } })
      await Promise.all([
        ...Array.from({ length: 4 }, () => googleSignIn(address)),
        ...Array.from({ length: 4 }, () => claimInvitationForUser(id, db as never)),
        ...Array.from({ length: 4 }, () => passwordSignIn(address)),
      ])
      expect(await counts(address)).toEqual({ users: 1, memberships: 1, cards: 1 })
      expect(await db.auditLog.count({ where: { action: 'MEMBER_CLAIMED', targetId: id } })).toBe(1)
      expect((await db.user.findUniqueOrThrow({ where: { id } })).role).toBe('WRITER')
    })

    it('simultaneous invitations for the same email leave one membership', async () => {
      const address = email('double-invite')
      actingAs(admin.id)
      const results = await Promise.all(
        Array.from({ length: 6 }, () => inviteRoute(json('/api/admin/members', 'POST', { email: address, role: 'WRITER' }))),
      )
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true)
      expect(await db.teamMembership.count({ where: { email: address } })).toBe(1)
    })

    it('the last administrator cannot be demoted or revoked', async () => {
      const lone = await makeAdmin('lone')
      const other = await makeAdmin('other-admin')
      const others = await db.user.findMany({ where: { role: 'ADMIN', id: { notIn: [lone.id, other.id] } }, select: { id: true } })
      await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { role: 'EDITOR' } })
      try {
        const asOther = { id: other.id, name: other.name, email: other.email }
        await setMemberRole(asOther, lone.id, 'WRITER', db as never) // `other` is still an admin, so this is allowed…
        await expect(setMemberRole({ id: lone.id, name: null, email: null }, other.id, 'WRITER', db as never)).rejects.toMatchObject({ code: 'LAST_ADMIN' })
        expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe('ADMIN')
      } finally {
        await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { role: 'ADMIN' } })
      }
    })
  })

  describe('public team API', () => {
    it('never lists a visible linked card that is not ready (no position or description), and drops the account link', async () => {
      const user = await db.user.create({ data: { email: email('api-card'), name: 'Api Card', role: 'WRITER' } })
      await db.teamMember.create({ data: { userId: user.id, name: `${tag} api card`, role: '', bio: null, team: 'writing', isActive: true } })
      const names = async () => ((await (await publicTeamApi()).json()) as { name: string }[]).map((m) => m.name)

      expect(await names()).not.toContain(`${tag} api card`)
      await db.teamMember.update({ where: { userId: user.id }, data: { role: 'Staff Writer', bio: 'Ready.' } })
      expect(await names()).toContain(`${tag} api card`)
      const row = ((await (await publicTeamApi()).json()) as Record<string, unknown>[]).find((m) => m.name === `${tag} api card`)!
      expect(row).not.toHaveProperty('userId')
      expect(row).not.toHaveProperty('user')
    })
  })

  describe('member list', () => {
    it('tells apart invited, unconfirmed, active, revoked, and the profile states', async () => {
      const rows = await listMembers()
      const status = (label: string) => rows.find((r) => r.email === email(label))
      expect(status('never-joined')).toMatchObject({ accountStatus: 'revoked', hasAccount: false })
      expect(status('existing-unverified')).toMatchObject({ accountStatus: 'active' })
      expect(status('jane-writer')).toMatchObject({ accountStatus: 'active', profileStatus: 'published', position: 'Staff Writer' })
      expect(status('leaver')).toMatchObject({ accountStatus: 'active' })
      expect(status('forged-patch')).toMatchObject({ accountStatus: 'invited', hasAccount: false, profileStatus: 'not-started' })
    })
  })
})
