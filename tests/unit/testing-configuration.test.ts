import { describe, it, expect, vi } from 'vitest'
import { isolatedServiceEnv } from '../../scripts/lib/testServices'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { testingConfigurationError } from '@/lib/testingMode'
const env = () => ({ ...isolatedServiceEnv({ appPort: 3340, storagePort: 55423, emailCaptureFile: '/tmp/test-mail.jsonl' }), TEST_DATABASE_URL: 'postgresql://postgres@localhost:55435/consilium', DATABASE_URL: 'postgresql://postgres@localhost:55435/consilium', DIRECT_URL: 'postgresql://postgres@localhost:55435/consilium' })
describe('testing environment gate', () => {
  it('accepts a wholly isolated local configuration', () => expect(testingConfigurationError(env())).toBeNull())
  it.each([
    { TESTING_MODE_ENABLED: '' }, { TEST_DATABASE_URL: '' }, { DATABASE_URL: 'postgresql://localhost/other' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co' }, { NEXTAUTH_URL: 'https://preview.example.com' },
    { EMAIL_TRANSPORT: 'resend' }, { EMAIL_CAPTURE_FILE: '' }, { RESEND_API_KEY: 'secret' },
    { GOOGLE_CLIENT_ID: 'id' }, { TESTING_WORKSPACE_ID: '' },
    { TEST_DATABASE_URL: 'postgresql://postgres@db.example.org/test', DATABASE_URL: 'postgresql://postgres@db.example.org/test', DIRECT_URL: 'postgresql://postgres@db.example.org/test', TEST_DB_ALLOW_HOST: 'db.example.org' },
  ])('refuses unsafe configuration %j', patch => expect(testingConfigurationError({ ...env(), ...patch })).not.toBeNull())
})
