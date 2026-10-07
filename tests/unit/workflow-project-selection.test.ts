import { readdirSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
// Read the actual Playwright project configuration without opening services.
vi.mock('../../scripts/lib/testDatabase', () => ({ applyTestDatabaseEnv: () => {}, resolveTestBaseUrl: (value: string) => value }))
vi.mock('../../scripts/lib/assertRunDatabase', () => ({ assertRunDatabase: () => {} }))
vi.mock('../../scripts/lib/testServices', () => ({ assertIsolatedServiceEnv: () => {} }))
afterEach(() => vi.unstubAllEnvs())
it('both desktop workflow projects select every enabled workflow spec; phone-only specs remain in phone projects', async () => {
 vi.stubEnv('E2E_BASE_URL', 'http://localhost:39999')
 vi.stubEnv('E2E_PHASE', '')
 const { default: config } = await import('../../playwright.config')
 const files = readdirSync('tests/e2e').filter(file => /^wf-.*\.spec\.ts$/.test(file))
 for (const name of ['wf-chromium', 'wf-webkit']) {
  const project = config.projects!.find(candidate => candidate.name === name)!
  expect(project, name).toBeTruthy()
  const pattern = project.testMatch as RegExp
  for (const file of files) expect(pattern.test(`/tests/e2e/${file}`), `${name} silently excluded ${file}`).toBe(file !== 'wf-mobile.spec.ts')
 }
 for (const name of ['wf-mobile-chromium', 'wf-mobile-webkit']) {
  const pattern = config.projects!.find(candidate => candidate.name === name)!.testMatch as RegExp
  expect(pattern.test('/tests/e2e/wf-mobile.spec.ts'), name).toBe(true)
 }
})
