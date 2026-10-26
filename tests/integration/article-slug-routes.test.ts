/**
 * Article addresses through the real write paths (create, autosave/edit, submission, review approval and
 * scheduling, the scheduled publisher). Prisma is an in-memory stand-in that knows which slugs and retired
 * addresses exist; the trigger-level guarantees are covered against PostgreSQL in article-slug-db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown> & { id: string; slug: string; title: string; status: string; slugLockedAt: Date | null }

const { prismaMock, authMock, state } = vi.hoisted(() => {
  const state = { taken: new Set<string>(), retired: new Set<string>(), existing: null as null | Record<string, unknown> }
  const prismaMock = {
    article: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.slug !== undefined) return state.taken.has(where.slug) ? { id: `other-${where.slug}` } : null
        return state.existing
      }),
      findMany: vi.fn(),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-1', updatedAt: new Date(), ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...state.existing, ...data, updatedAt: new Date() })),
      updateMany: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({ count: 1 })),
    },
    articleSlugRedirect: {
      findUnique: vi.fn(async ({ where }: { where: { oldSlug: string } }) => (state.retired.has(where.oldSlug) ? { id: 'r' } : null)),
    },
    articleTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { create: vi.fn(), createMany: vi.fn() },
    categoryEditor: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  }
  return {
    state,
    prismaMock,
    authMock: { authOptions: {}, requireActiveSession: vi.fn(), requireVerifiedSessionUser: vi.fn() },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => true),
  articleSubmittedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  articlePublishedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
  articleReturnedEmail: vi.fn(() => ({ subject: 's', html: 'h' })),
}))
vi.mock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: vi.fn(async () => true) }))
vi.mock('@/lib/gamification/achievements', () => ({ awardPublishAchievements: vi.fn() }))

import { POST } from '@/app/api/articles/route'
import { PUT } from '@/app/api/articles/[id]/route'
import { PATCH as REVIEW } from '@/app/api/editorial/articles/[id]/review/route'
import { publishScheduledArticles } from '@/lib/scheduledPublishing'
import { articlePublishedEmail } from '@/lib/email'

const ADMIN = { id: 'admin-1', role: 'ADMIN', name: 'Ada', email: 'ada@test' }
const WRITER = { id: 'writer-1', role: 'WRITER', name: 'Wren', email: 'wren@test' }
const params = { params: Promise.resolve({ id: 'article-1' }) }

function article(overrides: Partial<Row> = {}): Row {
  return {
    id: 'article-1', title: 'Will SI stocks make you rich in 2026?', slug: 'draft-1791210392433', content: '{}',
    excerpt: null, coverImage: null, categoryId: null, authorId: WRITER.id, status: 'DRAFT', publishedAt: null,
    scheduledAt: null, deletedAt: null, viewCount: 0, slugLockedAt: null, seriesId: null, updatedAt: new Date('2026-10-20T10:00:00Z'),
    author: { id: WRITER.id, name: 'Wren', email: 'wren@test' }, category: null, tags: [],
    ...overrides,
  }
}

const json = (url: string, method: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const put = (body: Record<string, unknown>) => PUT(json('http://localhost/api/articles/article-1', 'PUT', body), params)
const savedData = () => prismaMock.article.update.mock.calls.at(-1)![0].data as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  state.taken = new Set()
  state.retired = new Set()
  state.existing = article()
  authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: ADMIN })
  prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock))
})

describe('creating an article (first autosave)', () => {
  it('stores a provisional placeholder, never a slug cut from the half-typed headline', async () => {
    const res = await POST(json('http://localhost/api/articles', 'POST', { title: 'Will SI st', content: '{}' }))
    expect(res.status).toBe(201)
    const { slug, slugLockedAt } = prismaMock.article.create.mock.calls[0][0].data
    expect(slug).toMatch(/^draft-\d+$/)
    expect(slugLockedAt).toBeNull()
  })

  it("ignores a writer's client-sent slug; editors and admins choose addresses", async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: WRITER })
    await POST(json('http://localhost/api/articles', 'POST', { title: 'T', slug: 'my-own-slug', content: '{}' }))
    expect(prismaMock.article.create.mock.calls[0][0].data.slug).toMatch(/^draft-\d+$/)
  })

  it('validates and normalises an address an admin typed, and refuses one already in use or retired', async () => {
    await POST(json('http://localhost/api/articles', 'POST', { title: 'T', slug: 'Tulip Mania', content: '{}' }))
    expect(prismaMock.article.create.mock.calls[0][0].data.slug).toBe('tulip-mania')

    state.taken.add('tulip-mania')
    const taken = await POST(json('http://localhost/api/articles', 'POST', { title: 'T', slug: 'tulip-mania', content: '{}' }))
    expect(taken.status).toBe(409)
    expect(await taken.json()).toMatchObject({ code: 'SLUG_CONFLICT' })

    state.retired.add('draft-holder')
    const retired = await POST(json('http://localhost/api/articles', 'POST', { title: 'T', slug: 'draft holder', content: '{}' }))
    expect(retired.status).toBe(409)

    const invalid = await POST(json('http://localhost/api/articles', 'POST', { title: 'T', slug: '!!', content: '{}' }))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_SLUG' })
  })

  it('an article created already published gets its title address and is locked', async () => {
    await POST(json('http://localhost/api/articles', 'POST', { title: 'Tulip Mania: Lessons from the 17th century', content: '{}', status: 'PUBLISHED' }))
    const data = prismaMock.article.create.mock.calls[0][0].data
    expect(data.slug).toBe('tulip-mania-lessons-from-the-17th-century')
    expect(data.slugLockedAt).toBeInstanceOf(Date)
  })
})

describe('editing a draft', () => {
  it('title changes and autosaves leave the placeholder alone (no slug churn, no audit noise)', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: WRITER })
    for (const title of ['Will SI stocks', 'Will AI stocks make you rich?']) {
      expect((await put({ title, content: '{}', status: 'DRAFT' })).status).toBe(200)
      expect(savedData()).not.toHaveProperty('slug')
    }
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('an empty slug from an older client is "no change", not an empty address', async () => {
    expect((await put({ title: 'x', slug: '', status: 'DRAFT' })).status).toBe(200)
    expect(savedData()).not.toHaveProperty('slug')
  })

  it('repairs a draft that an earlier build saved with an empty address', async () => {
    state.existing = article({ slug: '' })
    await put({ title: 'Gulf Oil Is Back. Can Tar Sands Giants Keep Rising?', status: 'DRAFT' })
    expect(savedData().slug).toMatch(/^draft-\d+$/)
  })

  it('an admin can set an address before publication; it is validated and audited', async () => {
    const res = await put({ slug: 'SI Stocks 2026', status: 'DRAFT' })
    expect(res.status).toBe(200)
    expect(savedData().slug).toBe('si-stocks-2026')
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'article.slug_changed', metadata: expect.objectContaining({ before: 'draft-1791210392433', after: 'si-stocks-2026', reason: 'editor' }),
    })
  })

  it('refuses an address another article (or a retired address) already has', async () => {
    state.taken.add('si-stocks-2026')
    const res = await put({ slug: 'si-stocks-2026', status: 'DRAFT' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'SLUG_CONFLICT' })
    expect(prismaMock.article.update).not.toHaveBeenCalled()
  })
})

describe('the placeholder is replaced before anyone outside the newsroom sees it', () => {
  it('on submission for review, from the current title', async () => {
    authMock.requireVerifiedSessionUser.mockResolvedValue({ ok: true, user: WRITER })
    await put({ title: 'Will SI stocks make you rich in 2026?', status: 'PENDING_REVIEW' })
    expect(savedData().slug).toBe('will-si-stocks-make-you-rich-in-2026')
    expect(savedData().slugLockedAt).toBeNull()
  })

  it('on direct publication from the editor, with a collision suffix and the lock', async () => {
    state.taken.add('will-si-stocks-make-you-rich-in-2026')
    await put({ status: 'PUBLISHED', publicationIntent: true })
    expect(savedData().slug).toBe('will-si-stocks-make-you-rich-in-2026-2')
    expect(savedData().slugLockedAt).toBeInstanceOf(Date)
  })

  it('on scheduling from the editor', async () => {
    await put({ status: 'SCHEDULED', scheduledAt: '2099-01-01T09:00', publicationIntent: true })
    expect(savedData().slug).toBe('will-si-stocks-make-you-rich-in-2026')
  })

  it.each([
    ['approve', 'PUBLISHED'],
    ['schedule', 'SCHEDULED'],
  ])('on review %s of an article submitted before this change', async (action) => {
    state.existing = article({ status: 'PENDING_REVIEW', slug: 'draft-1782466289977', title: "Without Touching the Law: How Trade Deals Could Still Undo India's Pharma Patent Defences" })
    const res = await REVIEW(json('http://localhost/api/editorial/articles/article-1/review', 'PATCH', { action, scheduledAt: '2099-01-01T09:00' }), params)
    expect(res.status).toBe(200)
    const data = prismaMock.article.update.mock.calls[0][0].data
    expect(data.slug).toBe('without-touching-the-law-how-trade-deals-could-still-undo-indias-pharma-patent')
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce()
    if (action === 'approve') {
      expect(data.slugLockedAt).toBeInstanceOf(Date)
      // The author is told the final address, not the placeholder.
      expect(articlePublishedEmail).toHaveBeenCalledWith(expect.any(String), data.slug)
    }
  })

  it('by the scheduled publisher, for an article scheduled while it still had a placeholder', async () => {
    const due = article({ status: 'SCHEDULED', scheduledAt: new Date('2026-10-23T08:00:00Z'), title: 'Tulip Mania: Lessons from the 17th century', slug: 'draft-1785172614450' })
    prismaMock.article.findMany.mockResolvedValue([due])
    const now = new Date('2026-10-23T08:00:08Z')
    const result = await publishScheduledArticles(now)
    const { data } = prismaMock.article.updateMany.mock.calls[0][0]
    expect(data).toMatchObject({ status: 'PUBLISHED', slug: 'tulip-mania-lessons-from-the-17th-century', slugLockedAt: now })
    expect(result.published[0].slug).toBe('tulip-mania-lessons-from-the-17th-century')
  })

  it('the scheduled publisher keeps an address an editor chose', async () => {
    prismaMock.article.findMany.mockResolvedValue([article({ status: 'SCHEDULED', slug: 'tulip-mania' })])
    await publishScheduledArticles(new Date())
    expect(prismaMock.article.updateMany.mock.calls[0][0].data).not.toHaveProperty('slug')
  })
})

describe('a published address is permanent', () => {
  it('refuses a change while published', async () => {
    state.existing = article({ status: 'PUBLISHED', slug: 'tulip-mania', slugLockedAt: new Date() })
    const res = await put({ slug: 'tulip-mania-2' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'PUBLISHED_SLUG_LOCKED' })
  })

  it('refuses a change after unpublishing too (the old links are still out there)', async () => {
    state.existing = article({ status: 'DRAFT', slug: 'tulip-mania', slugLockedAt: new Date('2026-10-23T08:00:08Z') })
    const res = await put({ slug: 'tulip-mania-2', status: 'DRAFT' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'PUBLISHED_SLUG_LOCKED' })
  })

  it('a live article that still has a legacy placeholder keeps it (only the approved migration changes it)', async () => {
    state.existing = article({ status: 'PUBLISHED', slugLockedAt: new Date() })
    // Older clients resend the stored value on every save; that is not a change.
    expect((await put({ slug: 'draft-1791210392433' })).status).toBe(200)
    expect(savedData()).not.toHaveProperty('slug')
  })

  it('reports the database trigger refusal as a clear 409, not a 500', async () => {
    prismaMock.article.update.mockRejectedValueOnce(new Error('ARTICLE_SLUG_LOCKED: the web address of article article-1 is permanent'))
    const res = await put({ slug: 'si-stocks', status: 'DRAFT' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'PUBLISHED_SLUG_LOCKED' })
  })
})
