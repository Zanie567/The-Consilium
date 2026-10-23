import { beforeEach, expect, it, vi } from 'vitest'

// A writer may change the public photo credit and caption only while they could still edit the
// article itself (a draft, or one returned to them), the same rule as the body and the framing.
const mocks = vi.hoisted(() => ({
  user: { id: 'alice', role: 'WRITER' },
  article: { findUnique: vi.fn() },
  siteSetting: { findUnique: vi.fn(), upsert: vi.fn() },
}))
vi.mock('@/lib/auth', () => ({ requireVerifiedSessionUser: vi.fn(async () => ({ ok: true, user: mocks.user })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { article: mocks.article, siteSetting: mocks.siteSetting } }))
vi.mock('@/lib/testingAudit', () => ({ withTestingAudit: (handler: unknown) => handler }))
vi.mock('@/lib/articleCategoryAccess', () => ({ editorCanAccessArticleCategory: vi.fn(async () => true) }))
import { GET, PATCH } from '@/app/api/editorial/articles/[id]/cover-metadata/route'

const context = { params: Promise.resolve({ id: 'a1' }) }
const save = () => (PATCH as unknown as (r: Request, c: typeof context) => Promise<Response>)(
  new Request('http://localhost/api/editorial/articles/a1/cover-metadata', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption: 'A caption', source: 'Photographer', sourceUrl: '' }),
  }), context)
const article = (status: string, authorId = 'alice') =>
  mocks.article.findUnique.mockResolvedValue({ id: 'a1', coverImage: '/c.png', categoryId: null, deletedAt: null, authorId, status })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'alice', role: 'WRITER' }
  mocks.siteSetting.findUnique.mockResolvedValue(null)
  mocks.siteSetting.upsert.mockResolvedValue({})
})

it.each(['PENDING_REVIEW', 'SCHEDULED', 'ARCHIVED', 'PUBLISHED'])('a writer cannot change the credit once the article is %s', async (status) => {
  article(status)
  expect((await save()).status).toBe(403)
  expect(mocks.siteSetting.upsert).not.toHaveBeenCalled()
})

it.each(['DRAFT', 'REJECTED'])('a writer can still change the credit on their own %s article', async (status) => {
  article(status)
  expect((await save()).status).not.toBe(403)
})

it('a writer can still read the credit of their own submitted article (read-only panel)', async () => {
  article('PENDING_REVIEW')
  expect((await GET(new Request('http://localhost'), context)).status).toBe(200)
})

it('an editor can change the credit of a scheduled article', async () => {
  mocks.user = { id: 'ed', role: 'EDITOR' }
  article('SCHEDULED')
  expect((await save()).status).not.toBe(403)
})
