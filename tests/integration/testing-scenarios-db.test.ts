/**
 * Test scenarios against a REAL Postgres: apply is repeatable, reset restores the persona
 * exactly, only the five persona accounts and rows the scenarios themselves created are ever
 * touched, and the HTTP route admits only a real administrator on a matching Origin.
 *
 * `requireTestingWorkspace` (the verified-workspace guard) is stubbed to "verified" here because
 * the plain Vitest environment is deliberately NOT a testing workspace. That the real guard refuses
 * is proven separately (tests/unit/testing-scenarios-guard.test.ts and testing-configuration.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL

async function ready(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rows } = await client.query(`select count(*)::int as n from users where "testPersonaKey" is not null`)
    return rows[0].n >= 5
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
if (!isReady) console.warn('[testing-scenarios-db] skipped: needs a database with the five seeded test personas')
const suite = isReady ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string } } }
})
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }),
}))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('@/lib/testingMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/testingMode')>()
  return { ...actual, requireTestingWorkspace: async () => {}, auditTesting: async () => {} }
})

import { applyScenario, resetScenarios, scenarioState, ScenarioError } from '@/lib/testingScenarios'
import { SCENARIO_TAG } from '@/lib/testingScenarioCatalog'
import { assessProfile } from '@/lib/teamProfiles'
import { GET as getRoute, POST as postRoute } from '@/app/api/testing-scenarios/route'

let db: PrismaClient
const tag = `ts-${Date.now()}`
const ids = { admin: '', writer: '', writerOther: '', editor: '', growth: '', bystander: '' }

const persona = (key: string) => db.user.findUniqueOrThrow({ where: { testPersonaKey: key }, select: { id: true } })
const scenarioNotes = (userId: string) => db.notification.findMany({ where: { userId, type: SCENARIO_TAG } })
const strip = <T extends { updatedAt?: unknown }>(row: T | null) => (row ? { ...row, updatedAt: undefined } : null)

/** The check the dashboard prompt uses: what the member can still supply. */
async function missingFromMember(userId: string) {
  const account = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, teamProfile: true } })
  const card = account.teamProfile
  return assessProfile({ name: card?.name || account.name, bio: card?.bio, image: card?.image, position: card?.role, visible: card?.isActive ?? false }).missingFromMember
}

const post = (body: unknown, origin: string | null = 'http://localhost:3000') =>
  new NextRequest('http://localhost:3000/api/testing-scenarios', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  })

suite('test scenarios (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
    ids.writer = (await persona('writer')).id
    ids.writerOther = (await persona('writer-other')).id
    ids.editor = (await persona('editor')).id
    ids.growth = (await persona('growth')).id
    ids.admin = (await db.user.create({ data: { email: `${tag}-admin@consilium.test`, name: 'Scenario Admin', role: 'ADMIN', emailVerified: new Date() } })).id
    ids.bystander = (await db.user.create({ data: { email: `${tag}-bystander@consilium.test`, name: 'Bystander', role: 'WRITER', emailVerified: new Date() } })).id
  })
  beforeEach(async () => { state.session = { id: ids.admin }; await resetScenarios() })
  afterAll(async () => {
    await resetScenarios()
    await db.notification.deleteMany({ where: { userId: { in: [ids.bystander, ids.writer] }, title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { OR: [{ slug: { startsWith: tag } }, { authorId: { in: [ids.bystander] } }] } })
    await db.user.deleteMany({ where: { id: { in: [ids.admin, ids.bystander] } } })
    await db.$disconnect()
  })

  it('removing the profile and resetting restores the original card exactly, including its id', async () => {
    // Give the writer a recognisable card (or keep the one it has), then capture it.
    await db.teamMember.deleteMany({ where: { userId: ids.writer } })
    const original = await db.teamMember.create({ data: { userId: ids.writer, name: `${tag} Writer Card`, role: 'Staff Writer', publicTier: 'writer', bio: 'Original bio.', image: '/team/x.png', email: 'orig@ed.ac.uk', order: 17, isActive: true } })
    try {
      await applyScenario('writer', 'newly-registered')
      expect(await db.teamMember.count({ where: { userId: ids.writer } })).toBe(0)
      expect(await missingFromMember(ids.writer)).toEqual(['bio', 'photo']) // the prompt would show
      expect((await scenarioState('writer'))?.profile).toBe('removed')
      // Applying again, or applying a different profile scenario, must not lose the ORIGINAL snapshot.
      await applyScenario('writer', 'no-linked-profile')
      await applyScenario('writer', 'completed-profile')
      expect(await missingFromMember(ids.writer)).toEqual([]) // complete: the prompt would be gone
      expect((await scenarioState('writer'))?.profile).toBe('completed')

      await resetScenarios('writer')
      const restored = await db.teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })
      expect(strip(restored)).toEqual(strip(original))
      expect(restored.id).toBe(original.id)
      expect((await scenarioState('writer'))?.profile).toBe('untouched')
      expect(await db.siteSetting.count({ where: { key: { startsWith: 'testing-scenario-snapshot:' }, value: { contains: original.id } } })).toBe(0)
    } finally {
      await db.teamMember.deleteMany({ where: { userId: ids.writer } })
    }
  })

  it('a persona who never had a profile ends with none after reset (nothing is invented)', async () => {
    await db.teamMember.deleteMany({ where: { userId: ids.growth } })
    await applyScenario('growth', 'completed-profile')
    expect(await db.teamMember.count({ where: { userId: ids.growth } })).toBe(1)
    await resetScenarios('growth')
    expect(await db.teamMember.count({ where: { userId: ids.growth } })).toBe(0)
  })

  it('notification scenarios are repeatable, exclusive, and leave the persona’s own notifications alone', async () => {
    const own = await db.notification.create({ data: { userId: ids.writer, type: 'review', title: `${tag} real`, message: 'A real one' } })
    await applyScenario('writer', 'unread-notifications')
    await applyScenario('writer', 'unread-notifications') // again: same result, not six
    let notes = await scenarioNotes(ids.writer)
    expect(notes).toHaveLength(3)
    expect(notes.every((n) => !n.read)).toBe(true)
    expect((await scenarioState('writer'))?.notifications).toBe('unread')

    await applyScenario('writer', 'dismissed-notifications')
    notes = await scenarioNotes(ids.writer)
    expect(notes).toHaveLength(3)
    expect(notes.every((n) => n.read)).toBe(true)
    expect((await scenarioState('writer'))?.notifications).toBe('read')

    await resetScenarios('writer')
    expect(await scenarioNotes(ids.writer)).toHaveLength(0)
    expect(await db.notification.findUnique({ where: { id: own.id } })).toMatchObject({ read: false, title: `${tag} real` })
  })

  it('article scenarios create exactly the tagged rows, once each, and reset removes only those', async () => {
    const mine = await db.article.create({ data: { title: `${tag} existing`, slug: `${tag}-existing`, content: '{}', authorId: ids.writer, status: 'DRAFT' } })
    await applyScenario('writer', 'writer-draft')
    await applyScenario('writer', 'writer-draft')
    await applyScenario('writer', 'writer-submitted')
    const draft = await db.article.findMany({ where: { authorId: ids.writer, slug: { startsWith: SCENARIO_TAG } }, orderBy: { slug: 'asc' } })
    expect(draft.map((a) => a.status).sort()).toEqual(['DRAFT', 'PENDING_REVIEW'])
    expect(draft.every((a) => a.deletedAt === null && a.publishedAt === null)).toBe(true)
    expect(draft.find((a) => a.status === 'PENDING_REVIEW')?.categoryId).not.toBeNull()
    expect(await scenarioState('writer')).toMatchObject({ draft: true, submitted: true })

    await resetScenarios('writer')
    expect(await db.article.count({ where: { authorId: ids.writer, slug: { startsWith: SCENARIO_TAG } } })).toBe(0)
    expect(await db.article.findUnique({ where: { id: mine.id } })).not.toBeNull()
  })

  it('the editor queue is written by the second writer and cleared whichever persona resets', async () => {
    await applyScenario('editor', 'editor-queue')
    await applyScenario('editor', 'editor-queue')
    const queue = await db.article.findMany({ where: { slug: { startsWith: `${SCENARIO_TAG}-queue-` } } })
    expect(queue).toHaveLength(2)
    expect(queue.every((a) => a.status === 'PENDING_REVIEW' && a.authorId === ids.writerOther)).toBe(true)
    expect((await scenarioState('editor'))?.queue).toBe(true)
    await resetScenarios('editor')
    expect(await db.article.count({ where: { slug: { startsWith: `${SCENARIO_TAG}-queue-` } } })).toBe(0)
  })

  it('first-publish adds one unseen achievement and reset removes only that', async () => {
    await applyScenario('writer', 'first-publish')
    await applyScenario('writer', 'first-publish')
    const rows = await db.writerAchievement.findMany({ where: { userId: ids.writer, referenceId: SCENARIO_TAG } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'first_publish', seenAt: null })
    await resetScenarios('writer')
    expect(await db.writerAchievement.count({ where: { userId: ids.writer, referenceId: SCENARIO_TAG } })).toBe(0)
  })

  it('refuses a scenario that does not apply, an unknown one, and any account that is not a test persona', async () => {
    await expect(applyScenario('growth', 'writer-draft')).rejects.toMatchObject({ code: 'NOT_APPLICABLE' })
    await expect(applyScenario('writer', 'editor-queue')).rejects.toMatchObject({ code: 'NOT_APPLICABLE' })
    await expect(applyScenario('writer', 'explode')).rejects.toBeInstanceOf(ScenarioError)
    await expect(applyScenario(ids.bystander as never, 'unread-notifications')).rejects.toMatchObject({ code: 'NOT_APPLICABLE' })
    expect(await db.notification.count({ where: { userId: ids.bystander } })).toBe(0)
  })

  it('never touches an account that is not a test persona, even with scenario-shaped rows of its own', async () => {
    const bystanderNote = await db.notification.create({ data: { userId: ids.bystander, type: SCENARIO_TAG, title: `${tag} bystander`, message: 'not yours' } })
    const bystanderArticle = await db.article.create({ data: { title: `${tag} by`, slug: `${SCENARIO_TAG}-draft-${tag}-by`, content: '{}', authorId: ids.bystander, status: 'DRAFT' } })
    await applyScenario('writer', 'unread-notifications')
    await applyScenario('writer', 'writer-draft')
    await resetScenarios()
    expect(await db.notification.findUnique({ where: { id: bystanderNote.id } })).not.toBeNull()
    expect(await db.article.findUnique({ where: { id: bystanderArticle.id } })).not.toBeNull()
  })

  it('a failure part-way leaves the persona unchanged (one transaction)', async () => {
    await db.teamMember.deleteMany({ where: { userId: ids.editor } })
    const card = await db.teamMember.create({ data: { userId: ids.editor, name: `${tag} Editor Card`, role: 'Editor', bio: 'Keep me', order: 3, isActive: true } })
    try {
      const failing = new Proxy(db, {
        get(target, key, receiver) {
          if (key !== '$transaction') return Reflect.get(target, key, receiver)
          return (fn: (tx: unknown) => Promise<unknown>) =>
            target.$transaction((tx) => fn(new Proxy(tx, { get: (t, k, r) => (k === 'notification' ? { deleteMany: async () => { throw new Error('boom') } } : Reflect.get(t, k, r)) })))
        },
      }) as unknown as typeof db
      await expect(applyScenario('editor', 'unread-notifications', failing)).rejects.toThrow('boom')
      expect(await db.teamMember.count({ where: { userId: ids.editor } })).toBe(1)
      await expect(applyScenario('editor', 'newly-registered', failing)).rejects.toThrow('boom')
      // The profile removal and its snapshot rolled back together with the failure.
      expect(strip(await db.teamMember.findUnique({ where: { userId: ids.editor } }))).toEqual(strip(card))
      expect((await scenarioState('editor'))?.profile).toBe('untouched')
    } finally {
      await db.teamMember.deleteMany({ where: { userId: ids.editor } })
    }
  })

  describe('HTTP route', () => {
    it('admits only a real administrator presenting the site Origin', async () => {
      const ok = await postRoute(post({ action: 'apply', persona: 'writer', scenario: 'unread-notifications' }))
      expect(ok.status).toBe(200)
      expect(await scenarioNotes(ids.writer)).toHaveLength(3)

      expect((await postRoute(post({ action: 'reset', persona: 'writer' }, null))).status).toBe(403) // no Origin
      expect((await postRoute(post({ action: 'reset', persona: 'writer' }, 'https://evil.example'))).status).toBe(403)
      expect(await scenarioNotes(ids.writer)).toHaveLength(3) // neither refusal changed anything

      for (const who of [ids.writer, ids.editor, ids.growth, ids.bystander, null]) {
        state.session = who ? { id: who } : null
        expect((await postRoute(post({ action: 'reset' }))).status, String(who)).toBe(403)
        const read = await getRoute(new NextRequest('http://localhost:3000/api/testing-scenarios?persona=writer', { headers: { origin: 'http://localhost:3000' } }))
        expect(await read.json(), String(who)).toEqual({ state: null }) // nothing revealed
      }
      expect(await scenarioNotes(ids.writer)).toHaveLength(3)
    })

    it('rejects malformed requests without side effects', async () => {
      for (const body of [
        null, [], { action: 'apply' }, { action: 'apply', persona: 'writer' }, { action: 'apply', persona: 'admin', scenario: 'writer-draft' },
        { action: 'apply', persona: 'writer', scenario: 'writer-draft', userId: ids.bystander }, { action: 'delete-everything' },
        { action: 'reset', persona: 'someone-else' },
      ]) {
        const res = await postRoute(post(body))
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
      expect(await db.article.count({ where: { authorId: ids.writer, slug: { startsWith: SCENARIO_TAG } } })).toBe(0)
    })

    it('a read needs no Origin (browsers omit it on same-origin GETs) but a foreign one is refused', async () => {
      await applyScenario('writer', 'writer-draft')
      const plain = await getRoute(new NextRequest('http://localhost:3000/api/testing-scenarios?persona=writer'))
      expect(plain.status).toBe(200)
      const foreign = await getRoute(new NextRequest('http://localhost:3000/api/testing-scenarios?persona=writer', { headers: { origin: 'https://evil.example' } }))
      expect(await foreign.json()).toEqual({ state: null })
      state.session = { id: ids.writer }
      expect(await (await getRoute(new NextRequest('http://localhost:3000/api/testing-scenarios?persona=writer'))).json()).toEqual({ state: null })
    })

    it('reports the applied state to an administrator', async () => {
      await applyScenario('writer', 'writer-draft')
      const res = await getRoute(new NextRequest('http://localhost:3000/api/testing-scenarios?persona=writer', { headers: { origin: 'http://localhost:3000' } }))
      expect(res.status).toBe(200)
      expect((await res.json()).state).toMatchObject({ draft: true, submitted: false })
    })
  })
})
