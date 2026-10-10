import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`) }) }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'admin-1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {}, getVerifiedSessionUser: vi.fn(async () => ({ id: 'admin-1', role: 'ADMIN' })) }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/testingMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/testingMode')>()
  return { ...actual, requireTestingWorkspace: async () => { throw new Error('Testing mode is disabled. Configure a verified isolated workspace.') } }
})
// Client components are not rendered on the unavailable branch; keep their (browser-only) imports out.
vi.mock('@/components/layout/TestingControls', () => ({ TestingControls: () => null }))
vi.mock('@/components/admin/TestingScenarios', () => ({ TestingScenarios: () => null }))

import TestingPage from '@/app/admin/testing/page'
import * as auth from '@/lib/auth'

const render = async () => renderToStaticMarkup(await TestingPage())

describe('the Testing page on a deployment that is not an isolated workspace', () => {
  const saved = process.env.TESTING_WORKSPACE_URL
  beforeEach(() => { delete process.env.TESTING_WORKSPACE_URL })
  afterEach(() => { if (saved === undefined) delete process.env.TESTING_WORKSPACE_URL; else process.env.TESTING_WORKSPACE_URL = saved })

  it('still says unavailable, but now explains why and what is missing', async () => {
    const html = await render()
    expect(html).toContain('Unavailable: Testing mode is disabled. Configure a verified isolated workspace.')
    expect(html).toContain('Why is it unavailable?')
    expect(html).toContain('a safety rule, not a fault')
    expect(html).toContain('What this deployment is missing')
    expect(html).toContain('Live site · testing unavailable')
    expect(html).toContain('TESTING_MODE_ENABLED=1')
    expect(html).toContain('How to set it up safely')
    expect(html).toContain('npm run testing:workspace')
  })

  it('offers no way to start a session, apply a scenario or use any persona', async () => {
    const html = await render()
    expect(html).not.toMatch(/Test as /)
    expect(html).not.toContain('Apply')
    expect(html).not.toContain('Check access')
  })

  it('links to a separately hosted workspace only when a valid, credential-free origin is configured', async () => {
    process.env.TESTING_WORKSPACE_URL = 'https://consilium-testing.vercel.app'
    expect(await render()).toContain('href="https://consilium-testing.vercel.app/admin/testing"')
    process.env.TESTING_WORKSPACE_URL = 'https://user:pass@consilium-testing.vercel.app/path'
    const bad = await render()
    expect(bad).not.toContain('consilium-testing.vercel.app/admin/testing')
    expect(bad).toContain('Testing workspace link is invalid')
  })

  it('never prints configuration values', async () => {
    const before = { ...process.env }
    process.env.DATABASE_URL = 'postgresql://user:hunter2-secret@db.internal.example/prod'
    process.env.RESEND_API_KEY = 'sk-live-supersecret'
    try {
      const html = await render()
      for (const leak of ['hunter2', 'sk-live', 'db.internal.example']) expect(html).not.toContain(leak)
    } finally {
      process.env.DATABASE_URL = before.DATABASE_URL
      if (before.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY
    }
  })

  it('still keeps non-administrators out', async () => {
    vi.mocked(auth.getVerifiedSessionUser).mockResolvedValueOnce(null)
    await expect(TestingPage()).rejects.toThrow('redirect:/editorial')
  })
})
