import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { NextRequest } from 'next/server'
import { spawnSync } from 'node:child_process'
import { isolatedServiceEnv } from '../../scripts/lib/testServices'
import { testDatabaseEnv } from '../../scripts/lib/testDatabase'
const { state } = vi.hoisted(() => ({ state: { db: null as unknown, session: null as unknown } }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('next-auth', () => ({ getServerSession: async () => state.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
import { POST, DELETE } from '@/app/api/testing-session/route'
import { resolveTestingIdentity, tokenHash } from '@/lib/testingMode'
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseEnv().DATABASE_URL }) })
const ids: string[] = []
let adminId: string
const unique = `testing-security-${Date.now()}`
const envBefore = { ...process.env }
beforeAll(async () => {
  state.db = db
  Object.assign(process.env, isolatedServiceEnv({ appPort: 3340, storagePort: 55423, emailCaptureFile: '/tmp/test-mail.jsonl' }), testDatabaseEnv())
  const admin = await db.user.create({ data: { name: unique, email: `${unique}@consilium.test`, role: 'ADMIN', emailVerified: new Date() } })
  adminId = admin.id; ids.push(adminId)
  state.session = { user: { id: adminId } }
})
afterAll(async () => {
  await db.testingSession.deleteMany({ where: { administratorId: { in: ids } } })
  await db.auditLog.deleteMany({ where: { performedBy: { in: ids } } })
  await db.user.deleteMany({ where: { id: { in: ids }, name: { startsWith: unique } } })
  await db.$disconnect()
  process.env = envBefore
})
const request = (body: unknown, origin = 'http://localhost:3340') => new NextRequest('http://localhost:3340/api/testing-session', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function start(persona = 'writer') {
  state.session = { user: { id: adminId } }
  const response = await POST(request({ persona }))
  expect(response.status).toBe(200)
  return response.cookies.get('consilium-testing')!.value
}
describe('server testing capabilities (real DB)', () => {
  it('refuses a mismatched fixture workspace before changing any persona', async () => {
    const snapshot = () => db.user.findMany({ where: { testPersonaKey: { not: null } }, select: { id: true, role: true, testPersonaKey: true, emailVerified: true }, orderBy: { id: 'asc' } })
    const before = await snapshot()
    const result = spawnSync(process.execPath, ['node_modules/ts-node/dist/bin.js', '-P', 'tsconfig.seed.json', 'scripts/seed-testing-workspace.ts'], {
      env: { ...process.env, TESTING_WORKSPACE_ID: `${unique}-wrong-workspace` }, encoding: 'utf8', timeout: 15000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Workspace identity conflict')
    expect(await snapshot()).toEqual(before)
  }, 20000)
  it('repeating fixture setup preserves IDs, credentials and public appointments', async () => {
    const emails = ['testing-admin@consilium.test', 'writer@theconsilium.com', 'test-other-writer@consilium.test', 'editor.opinion@consilium.test', 'editor.global@consilium.test', 'growth@consilium.test']
    const snapshot = () => db.user.findMany({ where: { email: { in: emails } }, select: { id: true, role: true, password: true, name: true, image: true, bio: true, teamProfile: true }, orderBy: { id: 'asc' } })
    const before = await snapshot()
    expect(before).toHaveLength(emails.length)
    for (let run = 0; run < 2; run++) {
      const result = spawnSync(process.execPath, ['node_modules/ts-node/dist/bin.js', '-P', 'tsconfig.seed.json', 'scripts/seed-testing-workspace.ts'], { env: process.env, encoding: 'utf8', timeout: 15000 })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(await snapshot()).toEqual(before)
    }
  }, 40000)
  it('records both identities without changing real permissions or appointments', async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: adminId } })
    const token = await start()
    const identity = await resolveTestingIdentity(adminId, token)
    expect(identity?.effective.role).toBe('WRITER')
    expect(identity?.effective.testPersonaKey).toBe('writer')
    expect(identity?.administrator.id).toBe(adminId)
    const after = await db.user.findUniqueOrThrow({ where: { id: adminId } })
    expect(after.role).toBe(before.role)
    expect(after.password).toBe(before.password)
    const audit = await db.auditLog.findFirstOrThrow({ where: { performedBy: adminId, action: 'testing:start' } })
    expect(JSON.stringify(audit)).not.toContain(token)
    expect(audit.targetId).toBe(identity?.effective.id)
  })
  it.each(['WRITER', 'EDITOR', 'GROWTH', 'READER'] as const)('denies %s entry even with forged role', async role => {
    const user = await db.user.create({ data: { email: `${unique}-${role}@consilium.test`, name: unique, role, emailVerified: new Date() } }); ids.push(user.id)
    state.session = { user: { id: user.id, role: 'ADMIN' } }
    expect((await POST(request({ persona: 'writer' }))).status).toBe(403)
  })
  it('denies unauthenticated, inactive, banned, demoted and unverified administrators', async () => {
    state.session = null
    expect((await POST(request({ persona: 'writer' }))).status).toBe(403)
    for (const patch of [{ isActive: false }, { isBanned: true }, { role: 'WRITER' as const }, { emailVerified: null }]) {
      await db.user.update({ where: { id: adminId }, data: patch })
      state.session = { user: { id: adminId, role: 'ADMIN' } }
      expect((await POST(request({ persona: 'writer' }))).status).toBe(403)
      await db.user.update({ where: { id: adminId }, data: { isActive: true, isBanned: false, role: 'ADMIN', emailVerified: new Date() } })
    }
  })
  it('invalidates an active capability when the administrator or persona loses eligibility', async () => {
    for (const patch of [{ isActive: false }, { isBanned: true }, { role: 'WRITER' as const }]) {
      const token = await start('writer-other')
      await db.user.update({ where: { id: adminId }, data: patch })
      expect(await resolveTestingIdentity(adminId, token)).toBeNull()
      await db.user.update({ where: { id: adminId }, data: { isActive: true, isBanned: false, role: 'ADMIN' } })
      expect(await resolveTestingIdentity(adminId, token)).toBeNull()
    }
    const persona = await db.user.findUniqueOrThrow({ where: { testPersonaKey: 'writer-other' } })
    try {
      for (const patch of [{ isActive: false }, { isBanned: true }, { role: 'ADMIN' as const }, { emailVerified: null }]) {
        const token = await start('writer-other')
        await db.user.update({ where: { id: persona.id }, data: patch })
        expect(await resolveTestingIdentity(adminId, token)).toBeNull()
        await db.user.update({ where: { id: persona.id }, data: { isActive: persona.isActive, isBanned: persona.isBanned, role: persona.role, emailVerified: persona.emailVerified } })
        expect(await resolveTestingIdentity(adminId, token)).toBeNull()
      }
    } finally { await db.user.update({ where: { id: persona.id }, data: { isActive: persona.isActive, isBanned: persona.isBanned, role: persona.role, emailVerified: persona.emailVerified } }) }
  })

  it('requires same origin and rejects arbitrary user/role parameters', async () => {
    state.session = { user: { id: adminId } }
    for (const origin of ['', 'https://evil.example', 'http://localhost:9999']) expect((await POST(request({ persona: 'writer' }, origin))).status).toBe(403)
    for (const body of [{ persona: 'admin' }, { persona: 'writer', userId: adminId }, { persona: 'writer', role: 'ADMIN' }]) expect((await POST(request(body))).status).toBe(400)
  })
  it('serializes concurrent starts and leaves only one usable server capability', async () => {
    const tokens = await Promise.all([start('writer'), start('growth')])
    const identities = await Promise.all(tokens.map(token => resolveTestingIdentity(adminId, token)))
    expect(identities.filter(Boolean)).toHaveLength(1)
    expect(await db.testingSession.count({ where: { administratorId: adminId, stoppedAt: null } })).toBe(1)
  })
  it('rejects modified tokens, another administrator, and revoked sessions', async () => {
    const token = await start()
    expect(await resolveTestingIdentity(adminId, `${token}modified`)).toBeNull()
    const other = await db.user.create({ data: { name: unique, email: `${unique}-other@consilium.test`, role: 'ADMIN', emailVerified: new Date() } }); ids.push(other.id)
    expect(await resolveTestingIdentity(other.id, token)).toBeNull()
    await start('growth')
    expect(await resolveTestingIdentity(adminId, token)).toBeNull()
  })
  it('expires on the server and logs expiry exactly once', async () => {
    const token = await start()
    await db.testingSession.update({ where: { tokenHash: tokenHash(token) }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await resolveTestingIdentity(adminId, token)).toBeNull()
    expect(await resolveTestingIdentity(adminId, token)).toBeNull()
    expect(await db.auditLog.count({ where: { performedBy: adminId, action: 'testing:expiry' } })).toBe(1)
  })
  it('exit revokes the capability and restores the real administrator', async () => {
    const token = await start()
    const response = await DELETE(request({}))
    expect(response.status).toBe(200)
    expect(await resolveTestingIdentity(adminId, token)).toBeNull()
    expect((await resolveTestingIdentity(adminId))?.effective.id).toBe(adminId)
  })
  it('fails closed when the workspace marker is wrong', async () => {
    const previous = process.env.TESTING_WORKSPACE_ID
    process.env.TESTING_WORKSPACE_ID = 'unattested'
    state.session = { user: { id: adminId } }
    expect((await POST(request({ persona: 'writer' }))).status).toBe(503)
    process.env.TESTING_WORKSPACE_ID = previous
  })
})
