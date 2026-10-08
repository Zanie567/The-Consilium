import { afterEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ images: vi.fn(), analytics: vi.fn() }))
vi.mock('@/lib/articleImageStorage', () => ({ collectUnusedArticleImages: mocks.images }))
vi.mock('@/lib/analyticsEngagement', () => ({ pruneReadingAnalytics: mocks.analytics }))
import { GET as images } from '@/app/api/cron/cleanup-article-images/route'
import { GET as analytics } from '@/app/api/cron/cleanup-reading-analytics/route'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
for (const [name, handler, mock] of [
  ['images', images, mocks.images],
  ['analytics', analytics, mocks.analytics],
] as const)
  describe(`${name} cleanup authorization`, () => {
    it('refuses missing/wrong secret without cleanup', async () => {
      vi.stubEnv('CRON_SECRET', 'local-secret')
      expect((await handler(new Request('http://localhost/cron'))).status).toBe(401)
      expect(
        (
          await handler(
            new Request('http://localhost/cron', { headers: { authorization: 'Bearer wrong' } })
          )
        ).status
      ).toBe(401)
      expect(mock).not.toHaveBeenCalled()
    })
    it('fails closed if unconfigured', async () => {
      vi.stubEnv('CRON_SECRET', '')
      expect((await handler(new Request('http://localhost/cron'))).status).toBe(500)
      expect(mock).not.toHaveBeenCalled()
    })
    it('runs authorized cleanup and returns friendly failure', async () => {
      vi.stubEnv('CRON_SECRET', 'local-secret')
      mock.mockResolvedValueOnce(2)
      const req = () =>
        new Request('http://localhost/cron', { headers: { authorization: 'Bearer local-secret' } })
      expect(await (await handler(req())).json()).toEqual({ removed: 2 })
      mock.mockRejectedValueOnce(new Error('private'))
      const failed = await handler(req())
      expect(failed.status).toBe(503)
      expect(await failed.text()).not.toContain('private')
    })
  })
