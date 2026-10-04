import { databaseConnection, SUPABASE_DATABASE_CA } from '@/lib/hostedDatabaseConnection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_TEST_WORKSPACE as w, HOSTED_TEST_BUCKETS, hostedBucketSql, hostedTestingConfigurationError } from '@/lib/hostedTestingWorkspace'
import fs from 'node:fs'
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), query: vi.fn(), execute: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { siteSetting: { findUnique: mocks.findUnique }, $queryRaw: mocks.query, $executeRaw: mocks.execute } }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))
import { testingConfigurationError, requireTestingWorkspace } from '@/lib/testingMode'
import { sendEmail } from '@/lib/email'
const configuration = () => ({
  TESTING_MODE_ENABLED: '1', TESTING_WORKSPACE_KIND: 'hosted', TESTING_WORKSPACE_ID: w.workspaceId,
  DATABASE_URL: `postgresql://${w.databaseRole}.${w.projectRef}:test-only@${w.poolerHost}:6543/postgres?sslmode=verify-full`,
  DIRECT_URL: `postgresql://${w.databaseRole}.${w.projectRef}:test-only@${w.poolerHost}:6543/postgres?sslmode=verify-full`,
  NEXTAUTH_URL: w.siteOrigin, NEXT_PUBLIC_SITE_URL: w.siteOrigin, NEXT_PUBLIC_SUPABASE_URL: w.storageOrigin,
  EMAIL_TRANSPORT: 'capture-db', OUTBOUND_INTEGRATIONS_DISABLED: '1', RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FRED_API_KEY: '', ALPHA_VANTAGE_API_KEY: '',
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
describe('reviewed hosted interactive workspace', () => {
  it('accepts only its independently reviewed resources', () => expect(testingConfigurationError(configuration())).toBeNull())
  it.each([
    { TESTING_MODE_ENABLED: '0' }, { TESTING_WORKSPACE_ID: 'production' }, { TESTING_WORKSPACE_KIND: 'arbitrary' },
    { TEST_DATABASE_URL: 'postgresql://localhost/test' }, { TEST_HARNESS: '1' }, { E2E_ISOLATED: '1' },
    { NEXTAUTH_URL: 'https://theconsilium.co.uk' }, { NEXT_PUBLIC_SITE_URL: 'https://theconsilium.co.uk' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://scllbuwkcqtmfogsgalt.supabase.co' },
    { DATABASE_URL: 'postgresql://postgres:secret@localhost/test' }, { DIRECT_URL: '' },
    { EMAIL_TRANSPORT: 'resend' }, { RESEND_API_KEY: 'real-key' }, { OUTBOUND_INTEGRATIONS_DISABLED: undefined }, { FRED_API_KEY: 'key' },
  ])('rejects configuration drift %j', patch => expect(testingConfigurationError({ ...configuration(), ...patch })).not.toBeNull())
  it.each([
    `postgresql://${w.databaseRole}.scllbuwkcqtmfogsgalt:secret@${w.poolerHost}:6543/postgres?sslmode=verify-full`,
    `postgresql://${w.databaseRole}.${w.projectRef}:secret@${w.poolerHost}:6543/postgres?sslmode=require`,
    `postgresql://${w.databaseRole}.${w.projectRef}:secret@${w.poolerHost}:5432/postgres?sslmode=verify-full`,
    `postgresql://${w.databaseRole}.${w.projectRef}:secret@production.example.com:6543/postgres?sslmode=verify-full`,
  ])('rejects a different project or weakened connection %s', url => expect(hostedTestingConfigurationError({ ...configuration(), DATABASE_URL: url, DIRECT_URL: url })).not.toBeNull())

  function attest() {
    for (const [key, value] of Object.entries(configuration())) vi.stubEnv(key, value)
    vi.stubEnv('TEST_DATABASE_URL', undefined)
    vi.stubEnv('TEST_HARNESS', undefined)
    vi.stubEnv('E2E_ISOLATED', undefined)
    mocks.findUnique.mockImplementation(({ where }: { where: { key: string } }) => Promise.resolve({ value: where.key === 'testing-workspace' ? w.workspaceId : JSON.stringify(w) }))
    mocks.query.mockResolvedValue([{ ready: true }])
    mocks.execute.mockResolvedValue(1)
  }
  it('uses the reviewed CA and preserves hostname verification without URL SSL overrides', () => {
    const env = configuration()
    const connection = databaseConnection(env, env.DATABASE_URL)
    expect(connection.ssl).toEqual({ ca: SUPABASE_DATABASE_CA, rejectUnauthorized: true })
    expect(new URL(connection.connectionString!).searchParams.has('sslmode')).toBe(false)
    expect(() => databaseConnection(env, env.DATABASE_URL + '&sslrejectunauthorized=false')).toThrow()
    expect(databaseConnection({}, 'postgresql://localhost/test')).toEqual({ connectionString: 'postgresql://localhost/test' })
  })
  it('allows absent provider credentials only with the explicit disabled-integration attestation', () => {
    const env = { ...configuration(), RESEND_API_KEY: undefined, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, FRED_API_KEY: undefined, ALPHA_VANTAGE_API_KEY: undefined }
    expect(hostedTestingConfigurationError(env)).toBeNull()
    expect(hostedTestingConfigurationError({ ...env, RESEND_API_KEY: 'real-key' })).not.toBeNull()
  })
  it('requires both database attestations and a private mail sink', async () => {
    attest()
    await expect(requireTestingWorkspace()).resolves.toBeUndefined()
    mocks.query.mockResolvedValue([{ ready: false }])
    await expect(requireTestingWorkspace()).rejects.toThrow('Private test email capture is unavailable')
  })
  it('captures actual mail in the attested database without sending or auditing secrets', async () => {
    attest()
    await sendEmail({ to: 'writer@consilium.test', subject: 'Review requested', html: '<p>Actual notification</p>' })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute.mock.calls[0][0].join('')).toContain('testing_email_outbox')
    expect(mocks.execute.mock.calls[0].slice(2)).toEqual(['writer@consilium.test', 'Review requested', '<p>Actual notification</p>'])
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('does not insert or send when attestation is wrong', async () => {
    attest(); mocks.findUnique.mockResolvedValue({ value: 'another-workspace' })
    await expect(sendEmail({ to: 'test@example.com', subject: 'x', html: 'x' })).rejects.toThrow('not attested')
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
  })
  it('reports capture failure without fabricating success or using the provider', async () => {
    attest(); mocks.execute.mockRejectedValue(new Error('capture unavailable'))
    await expect(sendEmail({ to: 'test@example.com', subject: 'x', html: 'x' })).rejects.toThrow('capture unavailable')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})

describe('hosted storage buckets are provisioned from committed code', () => {
  it('creates both public buckets with the reviewed limits, additively', () => {
    const sql = hostedBucketSql()
    expect(sql).toContain("('article-images','article-images',true,10485760,ARRAY['image/jpeg','image/png','image/gif','image/webp','image/avif']::text[])")
    expect(sql).toContain("('avatars','avatars',true,5242880,ARRAY['image/jpeg','image/png','image/gif','image/webp','image/avif']::text[])")
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING;$/)
    expect(sql).not.toMatch(/\b(DELETE|DROP|UPDATE|TRUNCATE)\b/i)
  })
  it('keeps the avatar limit equal to the readiness check and the upload route', () => {
    expect(HOSTED_TEST_BUCKETS.find(b => b.id === 'avatars')?.fileSizeLimit).toBe(5_242_880)
    expect(fs.readFileSync('src/lib/deploymentReadiness.ts', 'utf8')).toContain('5242880')
  })
  it('is part of the operator plan', () => {
    expect(fs.readFileSync('scripts/prepare-hosted-testing-plan.ts', 'utf8')).toContain('${hostedBucketSql()}')
  })
})
