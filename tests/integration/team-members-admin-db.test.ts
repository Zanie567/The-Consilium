/**
 * Team Members administration against a REAL Postgres: linking an existing Meet the Team
 * profile to an account, the integrity rules around it, administrator-only access, stale and
 * concurrent edits, reordering/deleting, the Editor-in-Chief guarantee, and what the public
 * Meet the Team roster actually shows afterwards.
 *
 * Real: Prisma, the UNIQUE(userId) index, the route handlers, `requireVerifiedSessionUser`,
 * the membership module and `loadPublicTeam`. Faked at the boundary only: the NextAuth cookie.
 * Every fixture carries `tag` and is removed afterwards.
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
    const { rowCount } = await client.query(
      `select 1 from information_schema.columns where table_name = 'team_members' and column_name = 'updatedAt'`,
    )
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const ready = await schemaIsReady()
if (!ready) console.warn('[team-members-admin-db] skipped: no local test database with team_members.updatedAt')
const suite = ready ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string } } }
})

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.prisma as Record<string | symbol, unknown>)[key] }),
}))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))

import { GET as publicTeamApi, POST as createRoute } from '@/app/api/team/route'
import { PUT as updateRoute, DELETE as deleteRoute } from '@/app/api/team/[id]/route'
import { POST as linkRoute, DELETE as unlinkRoute } from '@/app/api/admin/team-cards/[id]/link/route'
import { POST as reorderRoute } from '@/app/api/admin/team-cards/reorder/route'
import { GET as directoryRoute } from '@/app/api/admin/team-members/route'
import { PUT as selfProfile } from '@/app/api/team-profile/route'
import { loadPublicTeam } from '@/lib/publicTeam'
import { buildTeamMasthead } from '@/lib/teamHierarchy'
import { setMemberRole } from '@/lib/membership'
import { loadTeamDirectory } from '@/lib/teamDirectory'

let db: PrismaClient
const tag = `tm-${Date.now()}`
let n = 0

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })
const actingAs = (id: string | null) => { state.session = id ? { id } : null }

async function makeUser(role: Role, label: string, extra: Record<string, unknown> = {}) {
  n++
  return db.user.create({
    data: { email: `${tag}-${label}-${n}@ed.ac.uk`, name: `${tag} ${label} ${n}`, role, emailVerified: new Date(), ...extra },
  })
}
const makeCard = (label: string, extra: Record<string, unknown> = {}) =>
  db.teamMember.create({
    data: { name: `${tag} ${label}`, role: 'Staff Writer', bio: 'A real biography.', image: '/team/x.png', order: 7, isActive: true, publicTier: 'writer', ...extra },
  })
const cardOf = (id: string) => db.teamMember.findUniqueOrThrow({ where: { id } })
const audits = (targetId: string, action?: string) =>
  db.auditLog.findMany({ where: { targetId, ...(action ? { action } : {}) }, orderBy: { createdAt: 'asc' } })

async function link(cardId: string, userId: string, extra: Record<string, unknown> = {}) {
  const res = await linkRoute(json(`/api/admin/team-cards/${cardId}/link`, 'POST', { userId, ...extra }), idCtx(cardId))
  return { status: res.status, body: await res.json() }
}
async function unlink(cardId: string, extra: Record<string, unknown> = {}) {
  const res = await unlinkRoute(json(`/api/admin/team-cards/${cardId}/link`, 'DELETE', extra), idCtx(cardId))
  return { status: res.status, body: await res.json() }
}
async function update(cardId: string, body: Record<string, unknown>) {
  const res = await updateRoute(json(`/api/team/${cardId}`, 'PUT', body), idCtx(cardId))
  return { status: res.status, body: await res.json() }
}
async function publicNames() {
  return ((await loadPublicTeam()) as { name: string; role: string | null }[])
}

suite('Team Members administration (real database)', () => {
  let admin: Awaited<ReturnType<typeof makeUser>>

  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DB! }),
      omit: { user: { password: true } },
    }) as unknown as PrismaClient
    state.prisma = db
    admin = await makeUser('ADMIN', 'admin')
  })

  beforeEach(() => actingAs(admin.id))

  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    const cards = await db.teamMember.findMany({ where: { OR: [{ name: { startsWith: tag } }, { userId: { in: userIds } }] }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...cards.map((c) => c.id), ...userIds] } }, { performedBy: { in: userIds } }] } })
    await db.teamMember.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } })
    await db.teamMembership.deleteMany({ where: { email: { startsWith: tag } } })
    await db.user.deleteMany({ where: { id: { in: userIds } } })
    await db.$disconnect()
  })

  describe('assigning an existing profile to an account', () => {
    it('links the card and changes nothing but its owner; the person then edits it themselves', async () => {
      const writer = await makeUser('WRITER', 'newhire')
      const card = await makeCard('Legacy Writer', { email: null })
      const before = await cardOf(card.id)

      const res = await link(card.id, writer.id, { expectedUpdatedAt: before.updatedAt.toISOString() })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: card.id, userId: writer.id, changed: true })

      const after = await cardOf(card.id)
      expect(after.userId).toBe(writer.id)
      // Nothing the card said about the person was lost or rewritten.
      expect({ name: after.name, role: after.role, bio: after.bio, image: after.image, order: after.order, isActive: after.isActive, publicTier: after.publicTier })
        .toEqual({ name: before.name, role: before.role, bio: before.bio, image: before.image, order: before.order, isActive: before.isActive, publicTier: before.publicTier })
      expect(await db.user.findUniqueOrThrow({ where: { id: writer.id } })).toMatchObject({ role: 'WRITER' })

      const [row] = await audits(card.id, 'TEAM_CARD_LINKED')
      expect(row).toMatchObject({ performedBy: admin.id, targetType: 'team_member' })

      // They now own it: their own save edits THIS card and cannot touch the title.
      actingAs(writer.id)
      const form = new FormData()
      form.set('bio', 'Written by me.')
      const own = await selfProfile(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
      expect(own.status).toBe(200)
      expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(1)
      expect(await cardOf(card.id)).toMatchObject({ bio: 'Written by me.', role: 'Staff Writer', order: 7 })
    })

    it('is idempotent: linking the same pair again succeeds and writes no second audit row', async () => {
      const writer = await makeUser('WRITER', 'idem')
      const card = await makeCard('Idem')
      expect((await link(card.id, writer.id)).body.changed).toBe(true)
      const again = await link(card.id, writer.id)
      expect(again.status).toBe(200)
      expect(again.body.changed).toBe(false)
      expect(await audits(card.id, 'TEAM_CARD_LINKED')).toHaveLength(1)
    })

    it('never takes a card from its owner, and never gives an account a second card', async () => {
      const owner = await makeUser('WRITER', 'owner')
      const thief = await makeUser('EDITOR', 'other')
      const mine = await makeCard('Owned')
      const spare = await makeCard('Spare')
      await link(mine.id, owner.id)

      const taken = await link(mine.id, thief.id)
      expect(taken.status).toBe(409)
      expect(taken.body.code).toBe('ALREADY_LINKED')
      expect((await cardOf(mine.id)).userId).toBe(owner.id)

      const second = await link(spare.id, owner.id)
      expect(second.status).toBe(409)
      expect(second.body.code).toBe('ACCOUNT_HAS_CARD')
      expect((await cardOf(spare.id)).userId).toBeNull()
      expect(await db.teamMember.count({ where: { userId: owner.id } })).toBe(1)
    })

    it('refuses accounts that cannot be team members (reader, inactive, suspended, unknown)', async () => {
      const card = await makeCard('Picky')
      const targets = [
        await makeUser('READER', 'reader'),
        await makeUser('WRITER', 'inactive', { isActive: false }),
        await makeUser('EDITOR', 'banned', { isBanned: true }),
      ]
      for (const t of targets) {
        const res = await link(card.id, t.id)
        expect(res.status, t.email).toBe(400)
        expect(res.body.code).toBe('INELIGIBLE_ACCOUNT')
      }
      expect((await link(card.id, 'no-such-account')).status).toBe(400)
      expect((await cardOf(card.id)).userId).toBeNull()
    })

    it('two administrators racing to link different cards to one account: exactly one wins', async () => {
      const writer = await makeUser('WRITER', 'race')
      const a = await makeCard('Race A')
      const b = await makeCard('Race B')
      const [x, y] = await Promise.all([link(a.id, writer.id), link(b.id, writer.id)])
      expect([x.status, y.status].sort()).toEqual([200, 409])
      expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(1)
    })

    it('unlinking keeps the profile and its information, and frees the account for another card', async () => {
      const writer = await makeUser('WRITER', 'unlink')
      const first = await makeCard('First Profile')
      const second = await makeCard('Second Profile')
      await link(first.id, writer.id)
      const res = await unlink(first.id)
      expect(res.status).toBe(200)
      expect(await cardOf(first.id)).toMatchObject({ userId: null, bio: 'A real biography.', role: 'Staff Writer' })
      expect((await link(second.id, writer.id)).status).toBe(200)
      expect(await audits(first.id, 'TEAM_CARD_UNLINKED')).toHaveLength(1)
      // Unlinking an unowned card is a harmless no-op.
      expect((await unlink(first.id)).body.changed).toBe(false)
    })

    it('a stale view cannot link: the card changed since the form was loaded', async () => {
      const writer = await makeUser('WRITER', 'stale-link')
      const card = await makeCard('Stale Link')
      const loaded = (await cardOf(card.id)).updatedAt.toISOString()
      await update(card.id, { bio: 'Someone else edited this meanwhile.' })
      const res = await link(card.id, writer.id, { expectedUpdatedAt: loaded })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('STALE')
      expect((await cardOf(card.id)).userId).toBeNull()
    })
  })

  describe('creating, editing, hiding, deleting and ordering profiles', () => {
    it('creates a hidden profile linked to an account in one step, and refuses a duplicate name unless confirmed', async () => {
      const editor = await makeUser('EDITOR', 'create-link')
      const res = await createRoute(json('/api/team', 'POST', { name: `${tag} Brand New`, position: 'Deputy Editor', userId: editor.id, bio: 'Hello' }))
      expect(res.status).toBe(201)
      const created = await res.json()
      expect(created).toMatchObject({ userId: editor.id, isActive: false, role: 'Deputy Editor' })
      expect(await db.user.findUniqueOrThrow({ where: { id: editor.id } })).toMatchObject({ role: 'EDITOR' })
      expect(await audits(created.id, 'TEAM_CARD_CREATED')).toHaveLength(1)

      const dup = await createRoute(json('/api/team', 'POST', { name: `  ${tag.toUpperCase()} brand   new `, position: 'Writer' }))
      expect(dup.status).toBe(409)
      expect((await dup.json()).code).toBe('DUPLICATE_NAME')
      const confirmed = await createRoute(json('/api/team', 'POST', { name: `${tag} Brand New`, position: 'Writer', allowDuplicateName: true }))
      expect(confirmed.status).toBe(201)

      // An account that already has a profile cannot be given another through create.
      const second = await createRoute(json('/api/team', 'POST', { name: `${tag} Another`, userId: editor.id }))
      expect(second.status).toBe(409)
      expect(await db.teamMember.count({ where: { userId: editor.id } })).toBe(1)
    })

    it('editing persists, reaches the public roster, and a stale form is refused without overwriting', async () => {
      const writer = await makeUser('WRITER', 'edit')
      const card = await makeCard('Editable', { userId: writer.id, role: 'Writer' })
      const loaded = (await cardOf(card.id)).updatedAt.toISOString()

      const ok = await update(card.id, { name: `${tag} Editable Renamed`, position: 'Senior Editor', publicTier: 'senior_editor', bio: 'New bio', isActive: true, expectedUpdatedAt: loaded })
      expect(ok.status).toBe(200)
      // Persisted, and visible to the public.
      expect(await cardOf(card.id)).toMatchObject({ name: `${tag} Editable Renamed`, role: 'Senior Editor', publicTier: 'senior_editor', bio: 'New bio', isActive: true })
      const pub = (await publicNames()).find((m) => m.name === `${tag} Editable Renamed`)
      expect(pub?.role).toBe('Senior Editor')
      // The account's permission is untouched by a title change.
      expect((await db.user.findUniqueOrThrow({ where: { id: writer.id } })).role).toBe('WRITER')

      const stale = await update(card.id, { bio: 'Overwrites?', expectedUpdatedAt: loaded })
      expect(stale.status).toBe(409)
      expect(stale.body.code).toBe('STALE')
      expect((await cardOf(card.id)).bio).toBe('New bio')
      expect(await audits(card.id, 'TEAM_CARD_UPDATED')).toHaveLength(1)

      // Hide, then restore.
      expect((await update(card.id, { isActive: false })).status).toBe(200)
      expect((await publicNames()).some((m) => m.name === `${tag} Editable Renamed`)).toBe(false)
      expect((await update(card.id, { isActive: true })).status).toBe(200)
      expect((await publicNames()).some((m) => m.name === `${tag} Editable Renamed`)).toBe(true)
    })

    it('an edit that also changes the owner is all-or-nothing', async () => {
      const taken = await makeUser('WRITER', 'atomic-taken')
      await makeCard('Atomic Holder', { userId: taken.id })
      const card = await makeCard('Atomic', { bio: 'before' })
      // The link is refused (account already has a card), so the bio change must not apply either.
      const res = await update(card.id, { bio: 'after', userId: taken.id })
      expect(res.status).toBe(409)
      expect(await cardOf(card.id)).toMatchObject({ bio: 'before', userId: null })
      expect(await audits(card.id, 'TEAM_CARD_UPDATED')).toHaveLength(0)
    })

    it('rejects invalid fields with a 400 and changes nothing', async () => {
      const card = await makeCard('Validation')
      for (const bad of [{ order: -1 }, { order: 1.5 }, { order: 'x' }, { publicTier: 'ceo' }, { image: 'javascript:alert(1)' }, { email: 'nope' }, { bio: 'x'.repeat(5000) }, { name: '   ' }]) {
        const res = await update(card.id, { name: 'Fine', ...bad })
        expect(res.status, JSON.stringify(bad)).toBe(400)
      }
      expect(await cardOf(card.id)).toMatchObject({ name: `${tag} Validation`, order: 7 })
    })

    it('deleting removes it from the public page, keeps an audit snapshot, and a second delete is a clean 404', async () => {
      const card = await makeCard('Doomed')
      const res = await deleteRoute(json(`/api/team/${card.id}`, 'DELETE'), idCtx(card.id))
      expect(res.status).toBe(200)
      expect(await db.teamMember.count({ where: { id: card.id } })).toBe(0)
      expect((await publicNames()).some((m) => m.name === card.name)).toBe(false)
      expect((await audits(card.id, 'TEAM_CARD_DELETED'))[0].metadata).toMatchObject({ cardName: card.name, position: 'Staff Writer' })
      const again = await deleteRoute(json(`/api/team/${card.id}`, 'DELETE'), idCtx(card.id))
      expect(again.status).toBe(404)
      expect(await audits(card.id, 'TEAM_CARD_DELETED')).toHaveLength(1)
    })

    it('reordering sets the order of the list and rejects unknown or repeated profiles', async () => {
      const [a, b, c] = await Promise.all([makeCard('Order A'), makeCard('Order B'), makeCard('Order C')])
      const ok = await reorderRoute(json('/api/admin/team-cards/reorder', 'POST', { ids: [c.id, a.id, b.id] }))
      expect(ok.status).toBe(200)
      expect([await cardOf(c.id), await cardOf(a.id), await cardOf(b.id)].map((x) => x.order)).toEqual([10, 20, 30])
      expect((await reorderRoute(json('/api/admin/team-cards/reorder', 'POST', { ids: [a.id, 'ghost'] }))).status).toBe(404)
      expect((await reorderRoute(json('/api/admin/team-cards/reorder', 'POST', { ids: [a.id, a.id] }))).status).toBe(400)
      expect((await reorderRoute(json('/api/admin/team-cards/reorder', 'POST', { ids: [] }))).status).toBe(400)
      expect((await cardOf(a.id)).order).toBe(20)
    })
  })

  describe('only administrators', () => {
    it('refuse every Team Members operation for editors, writers, growth, readers and anonymous callers', async () => {
      const card = await makeCard('Protected')
      const victim = await makeUser('WRITER', 'victim')
      const roles: Role[] = ['EDITOR', 'WRITER', 'GROWTH', 'READER']
      const callers: (string | null)[] = [null]
      for (const role of roles) callers.push((await makeUser(role, `deny-${role}`)).id)

      for (const who of callers) {
        actingAs(who)
        const results = [
          (await link(card.id, victim.id)).status,
          (await unlink(card.id)).status,
          (await update(card.id, { bio: 'hacked' })).status,
          (await createRoute(json('/api/team', 'POST', { name: `${tag} Intruder` }))).status,
          (await deleteRoute(json(`/api/team/${card.id}`, 'DELETE'), idCtx(card.id))).status,
          (await reorderRoute(json('/api/admin/team-cards/reorder', 'POST', { ids: [card.id] }))).status,
          (await directoryRoute()).status,
        ]
        for (const status of results) expect([401, 403], `${who ?? 'anonymous'} got ${status}`).toContain(status)
      }
      expect(await cardOf(card.id)).toMatchObject({ bio: 'A real biography.', userId: null })
      expect(await db.teamMember.count({ where: { name: `${tag} Intruder` } })).toBe(0)
      expect(await db.auditLog.count({ where: { targetId: card.id } })).toBe(0)
    })

    it('a member cannot link themselves, change their own role or title, or edit anyone else', async () => {
      const writer = await makeUser('WRITER', 'selfish')
      const other = await makeUser('EDITOR', 'target')
      const othersCard = await makeCard('Not Yours', { userId: other.id, role: 'Editor-in-Chief', publicTier: 'editor_in_chief' })
      actingAs(writer.id)
      for (const forged of [{ userId: writer.id }, { role: 'ADMIN' }, { position: 'Editor-in-Chief' }, { publicTier: 'editor_in_chief' }, { id: othersCard.id }]) {
        const form = new FormData()
        form.set('bio', 'x')
        for (const [k, v] of Object.entries(forged)) form.set(k, v)
        const res = await selfProfile(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
        expect(res.status, JSON.stringify(forged)).toBe(400)
      }
      expect(await cardOf(othersCard.id)).toMatchObject({ userId: other.id, bio: 'A real biography.', role: 'Editor-in-Chief' })
      expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(0)
      expect((await db.user.findUniqueOrThrow({ where: { id: writer.id } })).role).toBe('WRITER')
    })
  })

  describe('Editor-in-Chief and public titles', () => {
    it('keeps the Editor-in-Chief card linked, titled and on the masthead whatever the account role does', async () => {
      const chief = await makeUser('ADMIN', 'chief')
      // Only one chief is ever shown at the top (the lowest `order`), and the seeded database already
      // has a legacy chief card, so this one takes the top position explicitly.
      const card = await makeCard('Chief Person', { userId: chief.id, role: 'Editor-in-Chief', publicTier: null, bio: 'Leads the publication.', order: -100 })
      const mastheadTitle = async () => {
        const roster = (await loadPublicTeam()) as Awaited<ReturnType<typeof loadPublicTeam>>
        const sections = buildTeamMasthead(roster)
        const found = sections.flatMap((s) => s.rows.flatMap((r) => r.members.map((m) => ({ section: s.id, tier: r.tier, name: m.name, role: m.role })))).find((m) => m.name === card.name)
        return found
      }
      expect(await mastheadTitle()).toMatchObject({ section: 'masthead', tier: 'editor_in_chief', role: 'Editor-in-Chief' })

      // A second administrator changes the account's permission role up, down and back.
      for (const role of ['EDITOR', 'GROWTH', 'WRITER', 'ADMIN'] as const) {
        await setMemberRole({ id: admin.id, name: admin.name, email: admin.email }, chief.id, role)
        const after = await cardOf(card.id)
        expect(after, `after ${role}`).toMatchObject({ userId: chief.id, role: 'Editor-in-Chief', name: card.name, isActive: true })
        expect(await mastheadTitle(), `masthead after ${role}`).toMatchObject({ section: 'masthead', tier: 'editor_in_chief', role: 'Editor-in-Chief' })
      }

      // Changing the PUBLIC title never changes the permission, in either direction.
      expect((await update(card.id, { position: 'Writer', publicTier: 'writer' })).status).toBe(200)
      expect((await db.user.findUniqueOrThrow({ where: { id: chief.id } })).role).toBe('ADMIN')
      expect((await update(card.id, { position: 'Editor-in-Chief', publicTier: null })).status).toBe(200)
      expect(await mastheadTitle()).toMatchObject({ tier: 'editor_in_chief', role: 'Editor-in-Chief' })
    })

    it('an administrator account with no card is not given a public title because of its role', async () => {
      const lone = await makeUser('ADMIN', 'lone-admin')
      const names = (await publicNames()).map((m) => m.name)
      expect(names).not.toContain(lone.name)
      expect(await db.teamMember.count({ where: { userId: lone.id } })).toBe(0)
      // Even signing in and saving their own profile cannot invent one: it needs an admin-assigned card.
      actingAs(lone.id)
      const form = new FormData()
      form.set('bio', 'I am an admin')
      const res = await selfProfile(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
      expect(res.status).toBe(403)
      expect(await db.teamMember.count({ where: { userId: lone.id } })).toBe(0)
    })
  })

  describe('the directory and the consistency report', () => {
    it('surfaces new sign-ups with likely cards, unlinked cards, and findings, and never links anything itself', async () => {
      const email = `${tag}-signup@ed.ac.uk`
      const signup = await db.user.create({ data: { email, name: `${tag} Signup Person`, role: 'READER', emailVerified: new Date() } })
      const legacy = await makeCard('Signup Person', { email, userId: null })
      const nameOnly = await makeCard('Lookalike', { email: null })
      const staff = await makeUser('WRITER', 'no-card', { name: `${tag} Lookalike` })

      const dir = await loadTeamDirectory(db)
      const recent = dir.recentSignups.find((s) => s.id === signup.id)
      expect(recent).toBeTruthy()
      expect(recent!.suggestions.map((s) => s.cardId)).toContain(legacy.id)
      expect(recent!.suggestions.find((s) => s.cardId === legacy.id)?.reasons).toContain('email')
      expect(dir.unlinkedCards.map((c) => c.id)).toEqual(expect.arrayContaining([legacy.id, nameOnly.id]))

      const kinds = dir.issues.map((i) => i.kind)
      expect(kinds).toContain('unlinked-card-matches-account')
      const noCard = dir.issues.find((i) => i.kind === 'staff-without-profile' && i.accountIds.includes(staff.id))
      expect(noCard?.cardIds).toContain(nameOnly.id) // a name match is offered as a hint
      // Reporting changed nothing.
      expect((await cardOf(legacy.id)).userId).toBeNull()
      expect((await cardOf(nameOnly.id)).userId).toBeNull()
    })

    it('the admin directory endpoint returns it to administrators', async () => {
      const res = await directoryRoute()
      expect(res.status).toBe(200)
      expect(Object.keys(await res.json()).sort()).toEqual(['issues', 'members', 'recentSignups', 'unlinkedCards'])
    })

    it('the public roster is available without signing in and never leaks owners or tokens', async () => {
      const card = await makeCard('Public Shape', { userId: (await makeUser('WRITER', 'shape')).id })
      actingAs(null)
      const res = await publicTeamApi()
      expect(res.status).toBe(200)
      const roster = (await res.json()) as Record<string, unknown>[]
      const entry = roster.find((m) => m.name === card.name)
      expect(entry).toBeTruthy()
      for (const key of ['userId', 'updatedAt', 'user', 'isActive']) expect(key in entry!, key).toBe(key === 'isActive')
    })
  })
})
