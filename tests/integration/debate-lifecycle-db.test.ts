/**
 * Debate administration against a REAL Postgres: unpublish, publish, soft delete, restore and
 * permanent delete, driven through the real route handlers.
 *
 * Real: Prisma, foreign keys and cascades, `requireVerifiedSessionUser`, the lifecycle route, the
 * edit/create routes, and every public surface that must stop showing a hidden debate (the
 * active-debate and vote APIs, the public list query, article search, a member's vote history).
 * Faked at the boundary only: the NextAuth cookie. Every fixture carries `tag` and is removed.
 *
 *   npm run test:setup-db      (or any local database with the debate lifecycle columns)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL

async function schemaIsReady(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(
      `select 1 from information_schema.columns where table_name = 'debates' and column_name = 'deletedAt'`,
    )
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const ready = await schemaIsReady()
if (!ready) console.warn('[debate-lifecycle-db] skipped: no local test database with debates.deletedAt')
const suite = ready ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string } } }
})

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.prisma as Record<string | symbol, unknown>)[key] }),
}))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))

import { POST as lifecycle } from '@/app/api/editorial/debates/[debateId]/lifecycle/route'
import { GET as getDebate, PATCH as patchDebate } from '@/app/api/editorial/debates/[debateId]/route'
import { GET as listDebates, POST as createDebate } from '@/app/api/editorial/debates/route'
import { GET as activeDebate } from '@/app/api/debates/active/route'
import { POST as vote } from '@/app/api/debates/[debateId]/vote/route'
import { GET as profileVotes } from '@/app/api/profile/debate-votes/route'
import { GET as search } from '@/app/api/search/route'
import { transitionDebate } from '@/lib/debateLifecycle'
import { publicDebateWhere } from '@/lib/debateVisibility'
import { publishedArticleWhere } from '@/lib/articleQueries'

let db: PrismaClient
const tag = `dl-${Date.now()}`
const ids = { admin: '', editor: '', writer: '', reader: '' }

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const patchReq = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const ctx = (debateId: string) => ({ params: Promise.resolve({ debateId }) })
const actingAs = (id: string | null) => { state.session = id ? { id } : null }

async function act(debateId: string, body: Record<string, unknown>) {
  const res = await lifecycle(post(`/api/editorial/debates/${debateId}/lifecycle`, body), ctx(debateId))
  return { status: res.status, body: await res.json() }
}

let counter = 0
/** A published debate with two published articles, written straight to the database. */
async function makeDebate(label: string, opts: { isActive?: boolean } = {}) {
  const n = ++counter
  const title = `${tag} ${label} ${n}`
  const mk = (side: string) =>
    db.article.create({
      data: {
        title: `${title} ${side} zebrafish`,
        slug: `${tag}-${label}-${n}-${side}`.toLowerCase(),
        content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"zebrafish"}]}]}',
        excerpt: 'zebrafish',
        authorId: ids.writer,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isDebate: true,
      },
    })
  const [forArticle, againstArticle] = await Promise.all([mk('for'), mk('against')])
  const debate = await db.debate.create({
    data: { title, forArticleId: forArticle.id, againstArticleId: againstArticle.id, isActive: opts.isActive ?? false },
  })
  return { debate, forArticle, againstArticle, title }
}

const fresh = (id: string) => db.debate.findUniqueOrThrow({ where: { id } })
const audits = (id: string) => db.auditLog.findMany({ where: { targetId: id, targetType: 'debate' }, orderBy: { createdAt: 'asc' } })
const isPubliclyListed = async (id: string) => (await db.debate.count({ where: publicDebateWhere({ id }) })) === 1
const articlesPublic = (idsList: string[]) => db.article.count({ where: publishedArticleWhere({ id: { in: idsList } }) })

async function searchHits(term: string) {
  const res = await search(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(term)}`))
  expect(res.status).toBe(200)
  return (await res.json()) as { title: string }[]
}

suite('debate lifecycle (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DB! }),
      omit: { user: { password: true } },
    }) as unknown as PrismaClient
    state.prisma = db
    const mkUser = (label: string, role: 'ADMIN' | 'EDITOR' | 'WRITER' | 'READER') =>
      db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    ids.admin = (await mkUser('admin', 'ADMIN')).id
    ids.editor = (await mkUser('editor', 'EDITOR')).id
    ids.writer = (await mkUser('writer', 'WRITER')).id
    ids.reader = (await mkUser('reader', 'READER')).id
  })

  beforeEach(() => actingAs(ids.admin))

  afterAll(async () => {
    const debates = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    await db.auditLog.deleteMany({
      where: { OR: [{ targetId: { in: debates.map((d) => d.id) } }, { performedBy: { in: Object.values(ids) } }] },
    })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('unpublish removes the debate and both articles from every public surface, and publish brings them back', async () => {
    const { debate, forArticle, againstArticle, title } = await makeDebate('unpub', { isActive: true })
    const both = [forArticle.id, againstArticle.id]
    // Visible first: through the list query, the article queries and article search.
    expect(await isPubliclyListed(debate.id)).toBe(true)
    expect(await articlesPublic(both)).toBe(2)
    expect((await searchHits(`${tag} unpub`)).some((a) => a.title.startsWith(title))).toBe(true)

    const res = await act(debate.id, { action: 'unpublish', expectedUpdatedAt: debate.updatedAt.toISOString() })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ visibility: 'unpublished', articlesChanged: 2 })

    const after = await fresh(debate.id)
    expect(after.unpublishedAt).not.toBeNull()
    expect(after.deletedAt).toBeNull()
    expect(after.isActive).toBe(false) // a hidden debate does not stay featured
    expect(await isPubliclyListed(debate.id)).toBe(false)
    expect(await articlesPublic(both)).toBe(0)
    expect((await searchHits(`${tag} unpub`)).some((a) => a.title.startsWith(title))).toBe(false)

    // The active-debate API never serves it, and voting on it is refused as "not found".
    const active = await (await activeDebate()).json()
    expect(active?.id).not.toBe(debate.id)
    actingAs(ids.reader)
    const voted = await vote(post(`/api/debates/${debate.id}/vote`, { side: 'FOR' }), ctx(debate.id))
    expect(voted.status).toBe(404)
    expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(0)

    actingAs(ids.admin)
    const back = await act(debate.id, { action: 'publish' })
    expect(back.status).toBe(200)
    expect(await isPubliclyListed(debate.id)).toBe(true)
    expect(await articlesPublic(both)).toBe(2)
    expect((await audits(debate.id)).map((a) => a.action)).toEqual(['DEBATE_UNPUBLISHED', 'DEBATE_PUBLISHED'])
  })

  it('defence in depth: even a hidden debate that is still flagged active is not served or votable', async () => {
    // The lifecycle clears isActive, but the public surfaces must not depend on that alone
    // (a stale write, a manual SQL change). Force the inconsistent state directly. Other
    // active debates are parked so "the active debate" can only be this one, then restored.
    const { debate } = await makeDebate('inconsistent')
    const others = await db.debate.findMany({ where: { isActive: true, id: { not: debate.id } }, select: { id: true } })
    await db.debate.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } })
    try {
      const served = async () => (await (await activeDebate()).json()) as { id?: string } | null
      await db.debate.update({ where: { id: debate.id }, data: { isActive: true, unpublishedAt: new Date() } })
      actingAs(ids.reader)
      expect((await vote(post(`/api/debates/${debate.id}/vote`, { side: 'FOR' }), ctx(debate.id))).status).toBe(404)
      expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(0)
      expect(await served()).toBeNull()

      await db.debate.update({ where: { id: debate.id }, data: { isActive: true, unpublishedAt: null, deletedAt: new Date() } })
      expect((await vote(post(`/api/debates/${debate.id}/vote`, { side: 'AGAINST' }), ctx(debate.id))).status).toBe(404)
      expect(await served()).toBeNull()

      // Control: the same row, visible, IS served. The assertions above are not vacuous.
      await db.debate.update({ where: { id: debate.id }, data: { isActive: true, unpublishedAt: null, deletedAt: null } })
      expect((await served())?.id).toBe(debate.id)
    } finally {
      await db.debate.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } })
    }
  })

  it('soft delete hides everything, keeps votes, records who/when, and restore returns it UNPUBLISHED', async () => {
    const { debate, forArticle, againstArticle } = await makeDebate('softdel')
    await db.debateVote.create({ data: { debateId: debate.id, userId: ids.reader, side: 'FOR' } })

    // The voter sees it in their history while it is public.
    actingAs(ids.reader)
    expect(((await (await profileVotes()).json()) as { debate: { id: string } }[]).some((v) => v.debate.id === debate.id)).toBe(true)

    actingAs(ids.admin)
    const del = await act(debate.id, { action: 'delete' })
    expect(del.status).toBe(200)
    const row = await fresh(debate.id)
    expect(row.deletedAt).not.toBeNull()
    expect(row.deletedById).toBe(ids.admin)
    expect(await isPubliclyListed(debate.id)).toBe(false)
    expect(await articlesPublic([forArticle.id, againstArticle.id])).toBe(0)
    expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(1) // retained
    // Referential integrity: the debate still points at real articles; nothing dangling.
    expect(await db.article.count({ where: { id: { in: [forArticle.id, againstArticle.id] } } })).toBe(2)

    actingAs(ids.reader)
    expect(((await (await profileVotes()).json()) as { debate: { id: string } }[]).some((v) => v.debate.id === debate.id)).toBe(false)

    actingAs(ids.admin)
    const restored = await act(debate.id, { action: 'restore' })
    expect(restored.body).toMatchObject({ visibility: 'unpublished' })
    const r = await fresh(debate.id)
    expect(r.deletedAt).toBeNull()
    expect(r.deletedById).toBeNull()
    expect(await isPubliclyListed(debate.id)).toBe(false) // restore never publishes by itself
    expect(await articlesPublic([forArticle.id, againstArticle.id])).toBe(0)

    expect((await act(debate.id, { action: 'publish' })).status).toBe(200)
    expect(await isPubliclyListed(debate.id)).toBe(true)
    expect(await articlesPublic([forArticle.id, againstArticle.id])).toBe(2)
    expect((await audits(debate.id)).map((a) => a.action)).toEqual(['DEBATE_DELETED', 'DEBATE_RESTORED', 'DEBATE_PUBLISHED'])
  })

  it('a duplicate delete is refused and writes exactly one audit row', async () => {
    const { debate } = await makeDebate('dup')
    expect((await act(debate.id, { action: 'delete' })).status).toBe(200)
    const second = await act(debate.id, { action: 'delete' })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('INVALID_STATE')
    expect((await audits(debate.id)).filter((a) => a.action === 'DEBATE_DELETED')).toHaveLength(1)
  })

  it('two simultaneous deletes: one wins, one is refused, one audit row, consistent state', async () => {
    const { debate, forArticle, againstArticle } = await makeDebate('race')
    const [a, b] = await Promise.all([act(debate.id, { action: 'delete' }), act(debate.id, { action: 'delete' })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect((await audits(debate.id)).filter((x) => x.action === 'DEBATE_DELETED')).toHaveLength(1)
    expect((await fresh(debate.id)).deletedAt).not.toBeNull()
    expect(await articlesPublic([forArticle.id, againstArticle.id])).toBe(0)
  })

  it('an administrator acting on a stale view is refused and nothing changes', async () => {
    const { debate } = await makeDebate('stale')
    const staleStamp = debate.updatedAt.toISOString()
    // Someone else edits the debate first.
    await patchDebate(patchReq(`/api/editorial/debates/${debate.id}`, { title: `${debate.title} edited` }), ctx(debate.id))
    const res = await act(debate.id, { action: 'delete', expectedUpdatedAt: staleStamp })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('STALE')
    expect((await fresh(debate.id)).deletedAt).toBeNull()
    expect(await audits(debate.id)).toHaveLength(1) // only the DEBATE_UPDATED row
  })

  it('a mutation that fails part-way leaves debate, articles and audit untouched (rolled back)', async () => {
    const { debate, forArticle, againstArticle } = await makeDebate('rollback')
    const failing = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== '$transaction') return Reflect.get(target, key, receiver)
        return (fn: (tx: unknown) => Promise<unknown>) =>
          target.$transaction((tx) =>
            fn(new Proxy(tx, {
              get: (t, k, r) =>
                k === 'auditLog' ? { create: async () => { throw new Error('audit write failed') } } : Reflect.get(t, k, r),
            })),
          )
      },
    }) as unknown as typeof db
    await expect(transitionDebate({ id: ids.admin }, debate.id, 'delete', {}, failing)).rejects.toThrow('audit write failed')
    const row = await fresh(debate.id)
    expect(row.deletedAt).toBeNull()
    expect(row.unpublishedAt).toBeNull()
    expect(await articlesPublic([forArticle.id, againstArticle.id])).toBe(2)
    expect(await audits(debate.id)).toHaveLength(0)
  })

  it('permanent delete needs a deleted debate and the exact title, removes votes, and sends both articles to Trash', async () => {
    const { debate, forArticle, againstArticle, title } = await makeDebate('purge')
    await db.debateVote.createMany({
      data: [
        { debateId: debate.id, userId: ids.reader, side: 'FOR' },
        { debateId: debate.id, anonymousId: `${tag}-anon`, side: 'AGAINST' },
      ],
    })
    const early = await act(debate.id, { action: 'purge', confirmTitle: title })
    expect(early.status).toBe(409) // must be soft-deleted first
    await act(debate.id, { action: 'delete' })
    const wrong = await act(debate.id, { action: 'purge', confirmTitle: 'not the title' })
    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe('CONFIRMATION_REQUIRED')
    expect(await db.debate.count({ where: { id: debate.id } })).toBe(1)

    const ok = await act(debate.id, { action: 'purge', confirmTitle: title })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ visibility: null, votesRemoved: 2 })
    expect(await db.debate.count({ where: { id: debate.id } })).toBe(0)
    expect(await db.debateVote.count({ where: { debateId: debate.id } })).toBe(0)
    const trashed = await db.article.findMany({ where: { id: { in: [forArticle.id, againstArticle.id] } } })
    expect(trashed).toHaveLength(2)
    expect(trashed.every((a) => a.deletedAt !== null)).toBe(true)
    // Nothing references them any more, so the retention purge's hard delete cannot hit a foreign key.
    await expect(db.article.deleteMany({ where: { id: { in: [forArticle.id, againstArticle.id] } } })).resolves.toMatchObject({ count: 2 })
    const log = (await audits(debate.id)).find((a) => a.action === 'DEBATE_PERMANENTLY_DELETED')
    expect(log?.metadata).toMatchObject({ votesRemoved: 2, title })
  })

  it('only administrators can run lifecycle actions; editors, writers, readers and anonymous callers cannot', async () => {
    const { debate } = await makeDebate('authz')
    const expectations: [string | null, number][] = [[ids.editor, 403], [ids.writer, 403], [ids.reader, 403], [null, 401]]
    for (const [who, status] of expectations) {
      actingAs(who)
      for (const action of ['unpublish', 'delete', 'restore', 'publish', 'purge']) {
        const res = await act(debate.id, { action, confirmTitle: debate.title })
        expect(res.status, `${who ?? 'anonymous'} ${action}`).toBe(status)
      }
    }
    const row = await fresh(debate.id)
    expect(row.deletedAt).toBeNull()
    expect(row.unpublishedAt).toBeNull()
    expect(await audits(debate.id)).toHaveLength(0)
  })

  it('rejects an unknown action and a missing debate without side effects', async () => {
    const { debate } = await makeDebate('invalid')
    expect((await act(debate.id, { action: 'explode' })).status).toBe(400)
    expect((await act(debate.id, { action: 'delete', expectedUpdatedAt: 5 })).status).toBe(400)
    const missing = await act('does-not-exist', { action: 'delete' })
    expect(missing.status).toBe(404)
    expect((await fresh(debate.id)).deletedAt).toBeNull()
  })

  it('editing: allowed for editors, refused for a deleted debate, a stale view, or featuring an unpublished debate', async () => {
    const { debate } = await makeDebate('edit')
    actingAs(ids.editor)
    const ok = await patchDebate(patchReq(`/api/editorial/debates/${debate.id}`, { title: `${debate.title} v2`, expectedUpdatedAt: debate.updatedAt.toISOString() }), ctx(debate.id))
    expect(ok.status).toBe(200)
    // Same stale stamp again: refused.
    const stale = await patchDebate(patchReq(`/api/editorial/debates/${debate.id}`, { title: 'x', expectedUpdatedAt: debate.updatedAt.toISOString() }), ctx(debate.id))
    expect(stale.status).toBe(409)

    actingAs(ids.admin)
    await act(debate.id, { action: 'unpublish' })
    actingAs(ids.editor)
    const feature = await patchDebate(patchReq(`/api/editorial/debates/${debate.id}`, { isActive: true }), ctx(debate.id))
    expect(feature.status).toBe(409)
    expect((await fresh(debate.id)).isActive).toBe(false)

    actingAs(ids.admin)
    await act(debate.id, { action: 'delete' })
    const onDeleted = await patchDebate(patchReq(`/api/editorial/debates/${debate.id}`, { title: 'nope' }), ctx(debate.id))
    expect(onDeleted.status).toBe(409)
    expect((await fresh(debate.id)).title).toContain('v2')

    actingAs(ids.writer)
    expect((await getDebate(new Request('http://localhost'), ctx(debate.id))).status).toBe(401)
  })

  it('the admin list shows every state, including deleted debates, to staff only', async () => {
    const live = await makeDebate('list-live')
    const hidden = await makeDebate('list-hidden')
    const gone = await makeDebate('list-gone')
    await act(hidden.debate.id, { action: 'unpublish' })
    await act(gone.debate.id, { action: 'delete' })
    const res = await listDebates()
    expect(res.status).toBe(200)
    const { rows } = (await res.json()) as { rows: { id: string; visibility: string; outOfSync: string | null }[] }
    const by = (id: string) => rows.find((r) => r.id === id)
    expect(by(live.debate.id)?.visibility).toBe('published')
    expect(by(hidden.debate.id)?.visibility).toBe('unpublished')
    expect(by(gone.debate.id)?.visibility).toBe('deleted')
    expect([live, hidden, gone].map((x) => by(x.debate.id)?.outOfSync)).toEqual([null, null, null])

    // An editor re-publishing one side by hand while the debate is hidden is surfaced, not hidden.
    await db.article.update({ where: { id: hidden.forArticle.id }, data: { status: 'PUBLISHED' } })
    const again = (await (await listDebates()).json()) as { rows: { id: string; outOfSync: string | null }[] }
    expect(again.rows.find((r) => r.id === hidden.debate.id)?.outOfSync).toMatch(/still publicly visible/)

    actingAs(ids.writer)
    expect((await listDebates()).status).toBe(401)
    actingAs(null)
    expect((await listDebates()).status).toBe(401)
  })

  it('creating a debate is atomic: a bad author creates nothing and keeps the featured debate featured', async () => {
    const featured = await makeDebate('featured', { isActive: true })
    const before = await db.article.count({ where: { title: { startsWith: `${tag} atomic` } } })
    const res = await createDebate(post('/api/editorial/debates', {
      title: `${tag} atomic`, isActive: true,
      forTitle: `${tag} atomic for`, forContent: '{}', forAuthorId: ids.writer,
      againstTitle: `${tag} atomic against`, againstContent: '{}', againstAuthorId: 'no-such-user',
    }))
    expect(res.status).toBe(400)
    expect(await db.article.count({ where: { title: { startsWith: `${tag} atomic` } } })).toBe(before)
    expect(await db.debate.count({ where: { title: `${tag} atomic` } })).toBe(0)
    expect((await fresh(featured.debate.id)).isActive).toBe(true)
  })
})
