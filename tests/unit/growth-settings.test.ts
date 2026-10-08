import { describe, it, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { validLinkedInUrl } from '@/lib/growthSettings'
import { articleShareUrl } from '@/lib/shareUrl'
describe('publication links', () => {
  it('validates a configured publication page and supports removal', () => {
    expect(validLinkedInUrl(' https://www.linkedin.com/company/consilium/ ')).toBe(
      'https://www.linkedin.com/company/consilium/'
    )
    expect(validLinkedInUrl(null)).toBeNull()
  })
  it.each([
    'https://linkedin.com',
    'http://linkedin.com/company/a',
    'https://linkedin.com.evil.test/company/a',
    'javascript:alert(1)',
    'https://user@linkedin.com/company/a',
    'https://linkedin.com/company/a?tracking=1',
  ])('rejects %s', (url) => expect(() => validLinkedInUrl(url)).toThrow())
  it.each(['http://localhost:3220', 'https://preview.vercel.app', 'https://127.0.0.1'])(
    'shares canonical production URL on %s',
    (url) => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', url)
      expect(articleShareUrl('policy outlook')).toBe(
        'https://theconsilium.co.uk/articles/policy%20outlook'
      )
      vi.unstubAllEnvs()
    }
  )
})
