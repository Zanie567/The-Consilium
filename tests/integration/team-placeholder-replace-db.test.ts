/**
 * "Replace with an existing profile" against a REAL Postgres, through the real route: an account whose
 * auto-generated placeholder card blocks linking its real profile. Covers the happy path, every refusal
 * (genuine card, owned target, stale rows, wrong account, non-admin) leaving BOTH cards untouched, a race
 * between two administrators, and what the public Meet the Team roster shows afterwards.
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
  const c = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try { await c.connect(); return (await c.query(`select 1 from information_schema.columns where table_name = 'team_members' and column_name = 'updatedAt'`)).rowCount === 1 } catch { return false } finally { await c.end().catch(() => {}) }
}
const ready = await schemaIsReady()
if (!ready) console.warn('[team-placeholder-replace-db] skipped: no local test database with team_members.updatedAt')
const suite = ready ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string } } }
})
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }) }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))

import { POST as replaceRoute } from '@/app/api/admin/team-cards/[id]/replace-placeholder/route'
import { loadPublicTeam } from '@/lib/publicTeam'
import { loadTeamDirectory } from '@/lib/teamDirectory'
import { ensureProfileCard } from '@/lib/membership'

let db: PrismaClient
const tag = `ph-${Date.now()}`
let n = 0
const json = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const actingAs = (id: string | null) => { state.session = id ? { id } : null }

/** updatedAt has millisecond resolution; make sure "edited after the admin looked" is really later. */
const tick = () => new Promise((r) => setTimeout(r, 15))

async function makeUser(role: Role, label: string) {
  n++
  return db.user.create({ data: { email: `${tag}-${label}-${n}@ed.ac.uk`, name: `${tag} ${label} ${n}`, role, emailVerified: new Date() } })
}
/** The card exactly as a claim creates it. */
async function placeholderFor(user: { id: string; name: string | null; email: string; role: Role }) {
  const made = await db.$transaction((tx) => ensureProfileCard(tx, user, { role: user.role }))
  return db.teamMember.findUniqueOrThrow({ where: { id: made!.id } })
}
const genuine = (label: string) => db.teamMember.create({ data: { name: `${tag} ${label}`, role: 'Staff Writer', bio: 'A real biography.', image: '/team/x.png', order: 7, isActive: true, publicTier: 'writer', email: 'real@ed.ac.uk' } })
const cardOf = (id: string) => db.teamMember.findUnique({ where: { id } })

async function replace(targetId: string, body: Record<string, unknown>) {
  const res = await replaceRoute(json(`/api/admin/team-cards/${targetId}/replace-placeholder`, body), { params: Promise.resolve({ id: targetId }) })
  return { status: res.status, body: await res.json() }
}
const req = (userId: string, placeholder: { id: string; updatedAt: Date }, target: { id: string; updatedAt: Date }) => ({
  userId, placeholderId: placeholder.id, expectedPlaceholderUpdatedAt: placeholder.updatedAt.toISOString(), expectedUpdatedAt: target.updatedAt.toISOString(),
})

suite('replacing an auto-generated placeholder with an existing profile (real database)', () => {
  let admin: Awaited<ReturnType<typeof makeUser>>
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    admin = await makeUser('ADMIN', 'admin')
  })
  beforeEach(() => actingAs(admin.id))
  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    const cards = await db.teamMember.findMany({ where: { OR: [{ name: { startsWith: tag } }, { userId: { in: ids } }] }, select: { id: true } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...cards.map((c) => c.id), ...ids] } }, { performedBy: { in: ids } }] } })
    await db.teamMember.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } })
    await db.user.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  })

  it('links the real profile untouched, removes only the placeholder, and keeps the account id and role', async () => {
    const writer = await makeUser('WRITER', 'claimed')
    const ph = await placeholderFor(writer)
    expect(ph.isActive).toBe(false) // a claim creates it hidden
    const target = await genuine('Real Profile')
    const before = await cardOf(target.id)

    const res = await replace(target.id, req(writer.id, ph, target))
    expect(res).toMatchObject({ status: 200, body: { targetId: target.id, userId: writer.id } })

    expect(await cardOf(ph.id)).toBeNull()
    const after = await cardOf(target.id)
    expect(after).toMatchObject({ userId: writer.id, name: before!.name, role: before!.role, bio: before!.bio, image: before!.image, email: before!.email, order: before!.order, isActive: true, publicTier: 'writer' })
    expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(1)
    const account = await db.user.findUniqueOrThrow({ where: { id: writer.id } })
    expect(account).toMatchObject({ id: writer.id, role: 'WRITER' }) // authorisation untouched

    const [trail] = await db.auditLog.findMany({ where: { targetId: target.id, action: 'TEAM_CARD_PLACEHOLDER_REPLACED' } })
    expect(trail.performedBy).toBe(admin.id)
    expect(trail.metadata).toMatchObject({ userId: writer.id, replacedPlaceholder: { id: ph.id, name: ph.name, wasVisible: false } })

    // Reload persistence: the directory (what the admin screen reads) and the public roster.
    const row = (await loadTeamDirectory(db as never)).members.find((m) => m.userId === writer.id)
    expect(row?.card).toMatchObject({ id: target.id, bio: 'A real biography.' })
    const names = (await loadPublicTeam()) as { name: string }[]
    expect(names.some((p) => p.name === target.name)).toBe(true)
    expect(names.some((p) => p.name === ph.name)).toBe(false)
  })

  it('refuses a genuine profile, whatever is written in it, and changes neither card', async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['bio', { bio: 'I wrote this.' }, /biography/],
      ['photo', { image: '/team/me.png' }, /photo/],
      ['visible', { isActive: true }, /visible/],
      ['hand-set title', { role: 'Senior Reporter' }, /title/],
      ['placed by an admin', { order: 3 }, /placed/],
      ['contact email', { email: 'me@ed.ac.uk' }, /contact/],
    ]
    for (const [label, edit, why] of cases) {
      const writer = await makeUser('WRITER', `genuine-${label.replace(/\W/g, '')}`)
      const ph = await placeholderFor(writer)
      await db.teamMember.update({ where: { id: ph.id }, data: edit })
      const placeholder = await cardOf(ph.id)
      const target = await genuine(`T ${label}`)
      const res = await replace(target.id, req(writer.id, placeholder!, target))
      expect(res.status, label).toBe(409)
      expect(res.body.code, label).toBe('NOT_PLACEHOLDER')
      expect(res.body.error, label).toMatch(why)
      expect(await cardOf(ph.id), label).toMatchObject({ userId: writer.id })
      expect((await cardOf(target.id))!.userId, label).toBeNull()
    }
  })

  it('treats a card whose name was written by a person as genuine', async () => {
    const writer = await makeUser('WRITER', 'renamed')
    const ph = await placeholderFor(writer)
    const edited = await db.teamMember.update({ where: { id: ph.id }, data: { name: `${tag} Chosen Public Name` } })
    const target = await genuine('T renamed')
    const res = await replace(target.id, req(writer.id, edited, target))
    expect(res).toMatchObject({ status: 409, body: { code: 'NOT_PLACEHOLDER' } })
    expect(await cardOf(ph.id)).not.toBeNull()
  })

  it('never takes a profile that already belongs to someone else, and leaves the placeholder in place', async () => {
    const owner = await makeUser('WRITER', 'owner'); const claimer = await makeUser('WRITER', 'claimer')
    const target = await genuine('Owned')
    await db.teamMember.update({ where: { id: target.id }, data: { userId: owner.id } })
    const owned = await cardOf(target.id)
    const ph = await placeholderFor(claimer)
    const res = await replace(target.id, req(claimer.id, ph, owned!))
    expect(res).toMatchObject({ status: 409, body: { code: 'ALREADY_LINKED' } })
    expect((await cardOf(target.id))!.userId).toBe(owner.id)
    expect(await cardOf(ph.id)).toMatchObject({ userId: claimer.id })
  })

  it('refuses stale pages: a placeholder filled in, or a target edited, since the administrator looked', async () => {
    const writer = await makeUser('WRITER', 'stale')
    const ph = await placeholderFor(writer)
    const target = await genuine('Stale Target')
    const seenPlaceholder = ph, seenTarget = target
    await tick()
    await db.teamMember.update({ where: { id: ph.id }, data: { bio: 'Written after the admin opened the page.' } })
    expect(await replace(target.id, req(writer.id, seenPlaceholder, seenTarget))).toMatchObject({ status: 409, body: { code: 'STALE' } })
    expect(await cardOf(ph.id)).not.toBeNull()

    const w2 = await makeUser('WRITER', 'stale2')
    const ph2 = await placeholderFor(w2); const t2 = await genuine('Stale Target 2')
    await tick()
    await db.teamMember.update({ where: { id: t2.id }, data: { bio: 'Edited by its subject meanwhile.' } })
    expect(await replace(t2.id, req(w2.id, ph2, t2))).toMatchObject({ status: 409, body: { code: 'STALE' } })
    expect(await cardOf(ph2.id)).not.toBeNull()
    expect((await cardOf(t2.id))!.userId).toBeNull()
  })

  it('a repeated or retried request is refused and changes nothing', async () => {
    const writer = await makeUser('WRITER', 'retry')
    const ph = await placeholderFor(writer); const target = await genuine('Retry Target')
    const body = req(writer.id, ph, target)
    expect((await replace(target.id, body)).status).toBe(200)
    const again = await replace(target.id, body)
    expect(again.status).toBe(409)
    expect(await db.teamMember.count({ where: { userId: writer.id } })).toBe(1)
    expect(await db.auditLog.count({ where: { targetId: target.id, action: 'TEAM_CARD_PLACEHOLDER_REPLACED' } })).toBe(1)
  })

  it('two administrators racing with different profiles: exactly one wins and the account never has two cards or none', async () => {
    const writer = await makeUser('WRITER', 'race')
    const ph = await placeholderFor(writer)
    const [a, b] = [await genuine('Race A'), await genuine('Race B')]
    const results = await Promise.all([replace(a.id, req(writer.id, ph, a)), replace(b.id, req(writer.id, ph, b))])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const owned = await db.teamMember.findMany({ where: { userId: writer.id } })
    expect(owned).toHaveLength(1)
    expect(await cardOf(ph.id)).toBeNull()
    const loserId = owned[0].id === a.id ? b.id : a.id
    expect((await cardOf(loserId))!.userId).toBeNull() // the loser's profile is not stranded or taken
  })

  it('validates the request and the account', async () => {
    const writer = await makeUser('WRITER', 'valid'); const other = await makeUser('WRITER', 'other')
    const ph = await placeholderFor(writer); const target = await genuine('Valid Target')
    expect((await replace(target.id, { userId: writer.id })).status).toBe(400)
    expect((await replace(ph.id, req(writer.id, ph, ph))).status).toBe(400) // same card on both sides
    // a placeholder that belongs to a DIFFERENT account is not this account's to replace
    expect((await replace(target.id, req(other.id, ph, target))).status).toBe(409)
    expect(await cardOf(ph.id)).toMatchObject({ userId: writer.id })
    // an account that cannot have a card (reader) is refused before anything is read
    const reader = await makeUser('READER', 'reader')
    expect((await replace(target.id, req(reader.id, ph, target))).status).toBe(400)
  })

  it('is administrator-only', async () => {
    const writer = await makeUser('WRITER', 'authz'); const editor = await makeUser('EDITOR', 'editor')
    const ph = await placeholderFor(writer); const target = await genuine('Authz Target')
    for (const who of [null, editor.id, writer.id]) {
      actingAs(who)
      const res = await replace(target.id, req(writer.id, ph, target))
      expect([401, 403]).toContain(res.status)
    }
    expect(await cardOf(ph.id)).not.toBeNull()
    expect((await cardOf(target.id))!.userId).toBeNull()
  })
})
