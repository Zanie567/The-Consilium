import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { testDatabaseEnv } from '../../scripts/lib/testDatabase'
import { isolatedServiceEnv } from '../../scripts/lib/testServices'

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'local_identity_test_secret'
  return { state: { db: null as unknown, token: '', verifiedIdentity: '', session: null as unknown } }
})
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('next-auth', async importOriginal => ({ ...await importOriginal<typeof import('next-auth')>(), getServerSession: async () => state.session }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => name === 'consilium-testing' && state.token ? { value: state.token } : undefined }),
  headers: async () => new Headers(state.verifiedIdentity ? { 'x-consilium-verified-identity': state.verifiedIdentity } : {}),
}))
import { authOptions, requireVerifiedSessionUser } from '@/lib/auth'
import { tokenHash } from '@/lib/testingMode'

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseEnv().DATABASE_URL }) })
const previousEnv = { ...process.env }
let administratorId: string
let personaId: string
let recordId: string
beforeAll(async () => {
  state.db = db
  Object.assign(process.env, isolatedServiceEnv({ appPort: 3340, storagePort: 55423, emailCaptureFile: '/tmp/test-identity-mail.jsonl' }), testDatabaseEnv())
  const tag = `identity-race-${Date.now()}`
  const admin = await db.user.create({ data: { email: `${tag}@consilium.test`, name: tag, role: 'ADMIN', emailVerified: new Date(), testingRevision: 1 } })
  administratorId = admin.id
  personaId = (await db.user.findUniqueOrThrow({ where: { testPersonaKey: 'writer' } })).id
  state.token = `${tag}-local-capability`
  const record = await db.testingSession.create({ data: { tokenHash: tokenHash(state.token), administratorId, personaId, revision: 1, expiresAt: new Date(Date.now() + 60_000) } })
  recordId = record.id
})
afterAll(async () => {
  await db.testingSession.deleteMany({ where: { administratorId } })
  await db.auditLog.deleteMany({ where: { performedBy: administratorId } })
  await db.user.deleteMany({ where: { id: administratorId, email: { startsWith: 'identity-race-' } } })
  await db.$disconnect()
  process.env = previousEnv
})
async function sessionRead() {
  const callback = authOptions.callbacks!.session!
  const session: Session = { user: { id: administratorId, role: 'ADMIN' }, expires: new Date(Date.now() + 60_000).toISOString() }
  const token: JWT = { id: administratorId, role: 'ADMIN' }
  return await callback({ session, token } as Parameters<typeof callback>[0]) as Session
}

it('preserves the actual writer during an attested persona mutation', async () => {
  state.verifiedIdentity = `${administratorId}:1:${recordId}`
  const session = await sessionRead()
  expect(session.user).toMatchObject({ id: personaId, role: 'WRITER', isActive: true })
  expect(session.testingIdentityChanged).toBeUndefined()
  state.session = session
})
it('a persona promoted after the session read cannot gain admin handler access', async () => {
  const persona = await db.user.findUniqueOrThrow({ where: { id: personaId } })
  // Model the subsequent permission reread without mutating a shared persona.
  const changed = vi.spyOn(db.user, 'findUnique').mockResolvedValueOnce({ ...persona, role: 'ADMIN' })
  try {
    const result = await requireVerifiedSessionUser(['ADMIN'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(409)
  } finally { changed.mockRestore() }
})
it('revocation between proxy and handler cannot restore administrator mutation powers', async () => {
  // The proxy already authorized the old writer identity before the switch.
  state.verifiedIdentity = `${administratorId}:1:${recordId}`
  await db.testingSession.update({ where: { id: recordId }, data: { stoppedAt: new Date(), stopReason: 'switch' } })
  await db.user.update({ where: { id: administratorId }, data: { testingRevision: 2 } })
  const session = await sessionRead()
  expect(session.user).toMatchObject({ id: '', role: 'READER', isActive: false })
  expect(session.testingIdentityChanged).toBe(true)
  expect(session.testing).toBeUndefined()
  expect((await db.user.findUniqueOrThrow({ where: { id: administratorId } })).role).toBe('ADMIN')
})
it('a fresh navigation after revocation restores normal administrator access', async () => {
  state.verifiedIdentity = ''
  expect((await sessionRead()).user).toMatchObject({ id: administratorId, role: 'ADMIN', isActive: true })
})
