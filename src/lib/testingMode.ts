import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { hostedTestingConfigurationError, HOSTED_TEST_WORKSPACE } from './hostedTestingWorkspace'

export const TESTING_COOKIE = 'consilium-testing'
export const TEST_PERSONAS = ['writer', 'writer-other', 'editor', 'editor-global', 'growth'] as const
export type TestPersona = typeof TEST_PERSONAS[number]
export const PERSONA_ROLES = { writer: 'WRITER', 'writer-other': 'WRITER', editor: 'EDITOR', 'editor-global': 'EDITOR', growth: 'GROWTH' } as const
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const local = (value?: string) => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value ?? '').hostname) } catch { return false }
}

/** Explicitly verified workspace only. A preview pointed at production is never eligible. */
export function testingConfigurationError(env: Record<string, string | undefined> = process.env): string | null {
  if (env.TESTING_MODE_ENABLED !== '1') return 'Testing mode is disabled. Configure a verified isolated workspace.'
  if (env.TESTING_WORKSPACE_KIND === 'hosted') return hostedTestingConfigurationError(env)
  if (env.TESTING_WORKSPACE_KIND && env.TESTING_WORKSPACE_KIND !== 'local') return 'Testing workspace kind is invalid.'
  if (!env.TEST_DATABASE_URL || env.DATABASE_URL !== env.TEST_DATABASE_URL || env.DIRECT_URL !== env.TEST_DATABASE_URL) return 'Testing requires an explicit TEST_DATABASE_URL used by both database connections.'
  try { assertSafeTestDatabaseHost(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL', { env }) } catch { return 'Testing database is not safe.' }
  if (!local(env.TEST_DATABASE_URL) || !local(env.NEXT_PUBLIC_SUPABASE_URL) || !local(env.NEXTAUTH_URL) || !local(env.NEXT_PUBLIC_SITE_URL)) return 'Testing services must all be local; hosted workspace verification is unavailable.'
  if (env.EMAIL_TRANSPORT !== 'capture' || !env.EMAIL_CAPTURE_FILE || env.RESEND_API_KEY || env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET || env.FRED_API_KEY || env.ALPHA_VANTAGE_API_KEY) return 'Testing requires captured email and disabled outbound integrations.'
  if (!env.TESTING_WORKSPACE_ID) return 'Testing workspace identity is missing.'
  return null
}
export async function requireTestingWorkspace() {
  const error = testingConfigurationError()
  if (error) throw new Error(error)
  const marker = await prisma.siteSetting.findUnique({ where: { key: 'testing-workspace' } })
  if (marker?.value !== process.env.TESTING_WORKSPACE_ID) throw new Error('Database is not attested as this testing workspace.')
  if (process.env.TESTING_WORKSPACE_KIND === 'hosted') {
    const hosted = await prisma.siteSetting.findUnique({ where: { key: 'testing-hosted-project' } })
    if (hosted?.value !== JSON.stringify(HOSTED_TEST_WORKSPACE)) throw new Error('Hosted database attestation does not match the reviewed resources.')
    const sink = await prisma.$queryRaw<{ ready: boolean }[]>`SELECT COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.testing_email_outbox')), false) AS ready`
    if (!sink[0]?.ready) throw new Error('Private test email capture is unavailable.')
  }
}

export async function resolveTestingIdentity(administratorId: string, opaqueToken?: string) {
  await requireTestingWorkspace()
  const administrator = await prisma.user.findUnique({ where: { id: administratorId } })
  if (!administrator) return null
  if (!opaqueToken) return administrator.isActive && !administrator.isBanned ? { administrator, effective: administrator, testing: null } : null
  const record = await prisma.testingSession.findUnique({ where: { tokenHash: tokenHash(opaqueToken) } })
  if (!record || record.administratorId !== administratorId || record.stoppedAt || record.revision !== administrator.testingRevision) return null
  const revoke = async (reason: string) => {
    const stopped = await prisma.testingSession.updateMany({ where: { id: record.id, stoppedAt: null }, data: { stoppedAt: new Date(), stopReason: reason } })
    if (stopped.count) await auditTesting(administratorId, record.personaId, 'testing:revoked', { sessionId: record.id, reason })
  }
  if (!administrator.isActive || administrator.isBanned || administrator.role !== 'ADMIN' || !administrator.emailVerified) {
    await revoke('administrator-ineligible')
    return null
  }
  if (record.expiresAt <= new Date()) {
    const stopped = await prisma.testingSession.updateMany({ where: { id: record.id, stoppedAt: null }, data: { stoppedAt: new Date(), stopReason: 'expiry' } })
    if (stopped.count) await auditTesting(administratorId, record.personaId, 'testing:expiry', { sessionId: record.id })
    return null
  }
  const persona = await prisma.user.findUnique({ where: { id: record.personaId } })
  const key = persona?.testPersonaKey as TestPersona
  if (!persona || !TEST_PERSONAS.includes(key) || persona.role !== PERSONA_ROLES[key] || !persona.isActive || persona.isBanned || !persona.emailVerified) {
    await revoke('persona-ineligible')
    return null
  }
  return { administrator, effective: persona, testing: { id: record.id, administratorId, persona: key, expiresAt: record.expiresAt.toISOString() } }
}

export async function auditTesting(administratorId: string, personaId: string, action: string, metadata: Record<string, string | number> = {}) {
  await prisma.auditLog.create({ data: { performedBy: administratorId, targetId: personaId, targetType: 'testing', action, metadata } })
}
