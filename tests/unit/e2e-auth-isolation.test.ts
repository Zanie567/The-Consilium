import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

it('concurrent servers cannot overwrite one another’s saved role sessions', async () => {
  vi.stubEnv('E2E_RUN_ID', 'next-e2e-3320-first')
  const first = await import('../e2e/helpers/authStorage')
  vi.resetModules()
  vi.stubEnv('E2E_RUN_ID', 'next-e2e-3200-second')
  const second = await import('../e2e/helpers/authStorage')
  for (const key of Object.keys(first) as (keyof typeof first)[]) {
    expect(first[key]).toContain('/.auth/next-e2e-3320-first/')
    expect(second[key]).toContain('/.auth/next-e2e-3200-second/')
    expect(first[key]).not.toBe(second[key])
  }
})
