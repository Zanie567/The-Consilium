import { describe, it, expect, vi } from 'vitest'
import { isolatedServiceEnv } from '../../scripts/lib/testServices'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { testingSetupStatus, WHY_UNAVAILABLE } from '@/lib/testingSetup'
import { testingConfigurationError } from '@/lib/testingMode'
import { SCENARIOS, SCENARIO_IDS, ALL_PERSONAS, scenarioById, scenariosFor } from '@/lib/testingScenarioCatalog'

const DB = 'postgresql://postgres@localhost:55435/consilium'
const good = () => ({
  ...isolatedServiceEnv({ appPort: 3340, storagePort: 55423, emailCaptureFile: '/tmp/test-mail.jsonl' }),
  TEST_DATABASE_URL: DB, DATABASE_URL: DB, DIRECT_URL: DB,
})
const failing = (env: Record<string, string | undefined>) => testingSetupStatus(env).checks.filter((c) => !c.ok).map((c) => c.id)

describe('testing setup checklist', () => {
  it('a live-site style environment is not ready and says exactly what is missing', () => {
    const status = testingSetupStatus({ NEXTAUTH_URL: 'https://theconsilium.co.uk', DATABASE_URL: 'postgresql://prod.example.com/db' })
    expect(status.ready).toBe(false)
    expect(status.guardMessage).toBe('Testing mode is disabled. Configure a verified isolated workspace.')
    expect(failing({ NEXTAUTH_URL: 'https://theconsilium.co.uk' })).toEqual(['enabled', 'database', 'services', 'email', 'identity'])
  })

  it('a fully isolated local environment satisfies every requirement and the guard', () => {
    const status = testingSetupStatus(good())
    expect(status.checks.every((c) => c.ok)).toBe(true)
    expect(status.ready).toBe(true)
    expect(status.guardMessage).toBeNull()
    expect(status.kind).toBe('local')
  })

  it.each([
    [{ TESTING_MODE_ENABLED: '' }, 'enabled'],
    [{ TEST_DATABASE_URL: '' }, 'database'],
    [{ DATABASE_URL: 'postgresql://postgres@localhost:1/other' }, 'database'],
    [{ NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co' }, 'services'],
    [{ NEXTAUTH_URL: 'https://preview.example.com' }, 'services'],
    [{ EMAIL_TRANSPORT: 'resend' }, 'email'],
    [{ RESEND_API_KEY: 'secret' }, 'email'],
    [{ GOOGLE_CLIENT_ID: 'id' }, 'email'],
    [{ TESTING_WORKSPACE_ID: '' }, 'identity'],
  ])('breaking %j fails "%s" and the guard agrees', (patch, id) => {
    const env = { ...good(), ...patch }
    expect(failing(env)).toContain(id)
    const status = testingSetupStatus(env)
    expect(status.ready).toBe(false)
    expect(testingConfigurationError(env)).not.toBeNull()
  })

  it('"ready" can never disagree with the enforcing guard', () => {
    const variants = [good(), { ...good(), TESTING_MODE_ENABLED: '' }, { ...good(), RESEND_API_KEY: 'x' }, { ...good(), TESTING_WORKSPACE_KIND: 'nonsense' }, {}, { TESTING_MODE_ENABLED: '1' }]
    for (const env of variants) expect(testingSetupStatus(env).ready).toBe(testingConfigurationError(env) === null)
  })

  it('an unknown workspace kind is reported, and hosted uses the reviewed-project check', () => {
    expect(testingSetupStatus({ ...good(), TESTING_WORKSPACE_KIND: 'nonsense' }).kind).toBe('invalid')
    expect(failing({ ...good(), TESTING_WORKSPACE_KIND: 'nonsense' })).toContain('kind')
    const hosted = testingSetupStatus({ TESTING_MODE_ENABLED: '1', TESTING_WORKSPACE_KIND: 'hosted' })
    expect(hosted.kind).toBe('hosted')
    expect(hosted.checks.map((c) => c.id)).toEqual(['enabled', 'kind', 'hosted'])
    expect(hosted.ready).toBe(false)
  })

  it('never prints a configured value, only variable names', () => {
    const secret = 'postgresql://user:hunter2-secret@db.internal.example/prod'
    const status = testingSetupStatus({ ...good(), DATABASE_URL: secret, RESEND_API_KEY: 'sk-live-supersecret' })
    const text = JSON.stringify(status)
    for (const leak of ['hunter2', 'sk-live', 'db.internal.example']) expect(text).not.toContain(leak)
  })

  it('explains in plain words that the refusal is deliberate', () => {
    expect(WHY_UNAVAILABLE).toMatch(/safety rule, not a fault/)
  })
})

describe('scenario catalogue', () => {
  it('has the required situations, each defined once', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([...SCENARIO_IDS])
    expect(new Set(SCENARIO_IDS).size).toBe(SCENARIO_IDS.length)
    for (const id of ['newly-registered', 'no-linked-profile', 'completed-profile', 'writer-draft', 'writer-submitted', 'editor-queue', 'unread-notifications', 'dismissed-notifications', 'restricted-access']) {
      expect(scenarioById(id), id).toBeTruthy()
    }
  })
  it('every persona has applicable scenarios and every scenario states what must, or must not, show', () => {
    for (const persona of ALL_PERSONAS) {
      const applicable = scenariosFor(persona)
      expect(applicable.length, persona).toBeGreaterThanOrEqual(5)
      for (const s of applicable) expect(s.expectations(persona).length, `${persona} ${s.id}`).toBeGreaterThan(0)
    }
  })
  it('role-specific scenarios apply only to the roles they make sense for', () => {
    expect(scenariosFor('growth').map((s) => s.id)).not.toEqual(expect.arrayContaining(['writer-draft']))
    expect(scenariosFor('editor').map((s) => s.id)).toContain('editor-queue')
    expect(scenariosFor('writer').map((s) => s.id)).not.toContain('editor-queue')
    expect(scenariosFor('writer').map((s) => s.id)).toEqual(expect.arrayContaining(['writer-draft', 'writer-submitted', 'first-publish']))
  })
  it('the first prompt is expected for a new member and not for a completed profile', () => {
    const prompt = (id: string) => scenarioById(id)!.expectations('writer').find((e) => /Complete your team profile/.test(e.what))
    expect(prompt('newly-registered')?.shouldShow).toBe(true)
    expect(prompt('no-linked-profile')?.shouldShow).toBe(true)
    expect(prompt('completed-profile')?.shouldShow).toBe(false)
  })
  it('no scenario ever promises administrator-only content to a persona', () => {
    for (const s of SCENARIOS) for (const e of s.expectations('writer')) {
      if (/administrator overview/i.test(e.what)) expect(e.shouldShow).toBe(false)
    }
  })
})
