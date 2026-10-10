/**
 * A debate is public only when the debate itself is published AND BOTH of its articles are public by the one
 * article rule. This file proves it against a REAL Postgres, through the real handlers and the real pages, for
 * every public surface that reads a debate:
 *   /opinion-debate (server-rendered), the homepage panel, GET /api/debates/active, POST /api/debates/[id]/vote,
 *   GET /api/profile/debate-votes and GET /api/profile/stats.
 *
 * The release blocker this guards (found on hosted staging): a published debate whose argument had been archived or
 * trashed on its own still rendered the title, excerpt and author of BOTH articles. Every assertion below is on what
 * is actually served (the rendered markup / the JSON body), never on whether a helper was called.
 *
 * Rules checked for each non-public state of either side:
 *   - nothing of EITHER article (title, excerpt, slug, author name, id) appears; the debate is absent, not partial;
 *   - a vote is refused and nothing is written;
 *   - an EXISTING vote stays stored, is not shown in the member's history, and the statistics agree with the history;
 *   - reading changes no row (articles and debates identical before and after), and nothing is republished;
 *   - when the editor legitimately restores the article, the debate and the member's old vote come back.
 * Plus: dangling relations, the debate's own hidden states, a valid debate as the positive control, both race
 * directions between a visibility change and a vote, and guards against a cached read path or a second copy of the rule.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionProvider } from 'next-auth/react'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL

async function ready(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const c = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try { await c.connect(); return (await c.query(`select 1 from pg_trigger where tgname = 'articles_hidden_debate_guard'`)).rowCount === 1 } catch { return false } finally { await c.end().catch(() => {}) }
}
const isReady = await ready()
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('articles_hidden_debate_guard is not installed in the isolated test database')
if (!isReady) console.warn('[debate-public-visibility-db] skipped: the guard trigger is not installed here')
const suite = isReady ? describe : describe.skip

const { state } = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-secret'
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  return { state: { prisma: undefined as unknown, session: null as null | { id: string }, anon: undefined as string | undefined } }
})
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, key) => (state.prisma as Record<string | symbol, unknown>)[key] }) }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return { ...actual, getServerSession: async () => (state.session ? { user: { id: state.session.id } } : null) }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'consilium_anon_id' && state.anon ? { value: state.anon } : undefined) }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true, getIp: () => 'test' }))
// Deliberately NOT a cache: every read goes to the database. The cache behaviour is asserted separately (source guards).
vi.mock('next/cache', () => ({ unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn, revalidateTag: () => {}, revalidatePath: () => {} }))

import { GET as getActive } from '@/app/api/debates/active/route'
import { POST as postVote } from '@/app/api/debates/[debateId]/vote/route'
import { GET as getHistory } from '@/app/api/profile/debate-votes/route'
import { GET as getStats } from '@/app/api/profile/stats/route'
import OpinionDebatePage from '@/app/opinion-debate/page'
import HomePage from '@/app/(home)/page'
import { withPublicDebate } from '@/lib/debateVoting'
import { PUBLIC_DEBATE_WHERE, publicDebateWhere } from '@/lib/debateVisibility'
import { transitionDebate } from '@/lib/debateLifecycle'
import { loadDebateAdminRows } from '@/lib/debateAdminQueries'

type Db = PrismaClient
let db: Db
const tag = `dpv-${Date.now()}`
let counter = 0
const people = { admin: '', voter: '', voter2: '', voter3: '' }
let deactivated: string[] = []

type ArticleState = 'PUBLISHED' | 'ARCHIVED' | 'TRASHED' | 'PUBLISHED_TRASHED' | 'DRAFT' | 'SCHEDULED' | 'PENDING_REVIEW' | 'IN_HIDDEN_DEBATE'
const NON_PUBLIC: ArticleState[] = ['ARCHIVED', 'TRASHED', 'PUBLISHED_TRASHED', 'DRAFT', 'SCHEDULED', 'PENDING_REVIEW', 'IN_HIDDEN_DEBATE']
const PRETTY: Record<ArticleState, string> = {
  PUBLISHED: 'published', ARCHIVED: 'archived', TRASHED: 'trashed (archived + deletedAt)', PUBLISHED_TRASHED: 'published-but-trashed (legacy inconsistent)',
  DRAFT: 'draft', SCHEDULED: 'scheduled', PENDING_REVIEW: 'pending review', IN_HIDDEN_DEBATE: 'public but a member of another, hidden debate (legacy)',
}

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

interface Fx {
  debate: { id: string }
  forArticle: { id: string; slug: string }
  againstArticle: { id: string; slug: string }
  /** Every identifying string of each side (title, excerpt, slug, id, author name). */
  side: { for: string[]; against: string[] }
  /** The debate's own title and description. */
  own: string[]
  cleanup: () => Promise<void>
}

/** A fully public debate: two PUBLISHED articles with unique, searchable metadata and their own author. */
async function makeDebate(opts: { isActive?: boolean; unpublishedAt?: Date | null; deletedAt?: Date | null } = {}): Promise<Fx> {
  const n = ++counter
  // One author per side, so a leak of either side's author name is attributable to that side.
  const author = (side: string) => db.user.create({ data: { email: `${tag}-author${n}${side}@ed.ac.uk`, name: `Author${tag.replace(/\W/g, '')}n${n}${side}`, role: 'WRITER', emailVerified: new Date() } })
  const authorFor = await author('for')
  const authorAgainst = await author('against')
  const mk = (side: 'for' | 'against', authorId: string) => db.article.create({
    data: {
      title: `Title ${tag} ${n} ${side}`, slug: `${tag}-${n}-${side}`, excerpt: `Excerpt ${tag} ${n} ${side}`, content: '{}',
      authorId, status: 'PUBLISHED', publishedAt: new Date(), isDebate: true,
    },
  })
  const f = await mk('for', authorFor.id)
  const a = await mk('against', authorAgainst.id)
  const debate = await db.debate.create({
    data: {
      title: `${tag} debate ${n}`, description: `Description ${tag} ${n}`, forArticleId: f.id, againstArticleId: a.id,
      isActive: opts.isActive ?? true, unpublishedAt: opts.unpublishedAt ?? null, deletedAt: opts.deletedAt ?? null,
    },
  })
  return {
    debate, forArticle: f, againstArticle: a,
    side: { for: [f.title, f.excerpt!, f.slug, f.id, authorFor.name!], against: [a.title, a.excerpt!, a.slug, a.id, authorAgainst.name!] },
    own: [`${tag} debate ${n}`, `Description ${tag} ${n}`],
    cleanup: async () => {
      await db.debateVote.deleteMany({ where: { debateId: debate.id } })
      await db.auditLog.deleteMany({ where: { targetId: debate.id } })
      await db.debate.deleteMany({ where: { OR: [{ id: debate.id }, { forArticleId: { in: [f.id, a.id] } }, { againstArticleId: { in: [f.id, a.id] } }] } })
      await db.article.deleteMany({ where: { id: { in: [f.id, a.id] } } })
      await db.article.deleteMany({ where: { slug: { startsWith: `${tag}-${n}-` } } })
      await db.user.deleteMany({ where: { id: { in: [authorFor.id, authorAgainst.id] } } })
    },
  }
}

/** Put one article into a non-public (or the public) state, the way an editor or legacy data would. */
async function setState(articleId: string, to: ArticleState, fx: Fx) {
  const past = new Date(Date.now() - 3600_000)
  switch (to) {
    case 'PUBLISHED': return void (await db.article.update({ where: { id: articleId }, data: { status: 'PUBLISHED', deletedAt: null, publishedAt: past } }))
    case 'ARCHIVED': return void (await db.article.update({ where: { id: articleId }, data: { status: 'ARCHIVED' } }))
    case 'TRASHED': return void (await db.article.update({ where: { id: articleId }, data: { status: 'ARCHIVED', deletedAt: new Date() } }))
    case 'PUBLISHED_TRASHED': return void (await db.article.update({ where: { id: articleId }, data: { status: 'PUBLISHED', deletedAt: new Date() } }))
    case 'DRAFT': return void (await db.article.update({ where: { id: articleId }, data: { status: 'DRAFT' } }))
    case 'PENDING_REVIEW': return void (await db.article.update({ where: { id: articleId }, data: { status: 'PENDING_REVIEW' } }))
    case 'SCHEDULED': return void (await db.article.update({ where: { id: articleId }, data: { status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 86_400_000) } }))
    case 'IN_HIDDEN_DEBATE': {
      // Legacy data: the article is PUBLISHED yet also belongs to a second debate an administrator has hidden.
      const other = await db.article.create({
        data: { title: `${tag} other side ${++counter}`, slug: `${tag}-${counter}-other`, content: '{}', excerpt: 'x', authorId: people.admin, status: 'PUBLISHED', publishedAt: new Date() },
      })
      await db.debate.create({ data: { title: `${tag} hidden twin ${counter}`, forArticleId: articleId, againstArticleId: other.id, isActive: false, unpublishedAt: new Date() } })
      return void fx
    }
  }
}
/** The legitimate editorial way back: publish the article again (or publish the hidden twin debate). */
async function restore(articleId: string, from: ArticleState) {
  if (from === 'IN_HIDDEN_DEBATE') {
    const twins = await db.debate.findMany({ where: { OR: [{ forArticleId: articleId }, { againstArticleId: articleId }], title: { startsWith: `${tag} hidden twin` } } })
    for (const t of twins) await db.debate.update({ where: { id: t.id }, data: { unpublishedAt: null } })
    return
  }
  await db.article.update({ where: { id: articleId }, data: { status: 'PUBLISHED', deletedAt: null, scheduledAt: null, publishedAt: new Date(Date.now() - 3600_000) } })
}

async function vote(debateId: string, side: 'FOR' | 'AGAINST' = 'FOR') {
  return postVote(req(`/api/debates/${debateId}/vote`, 'POST', { side }), { params: Promise.resolve({ debateId }) })
}

interface Served { active: string; page: string; home: string; history: Array<{ debate: { id: string } }>; stats: { totalDebateVotes: number } }
async function serve(): Promise<Served> {
  const active = JSON.stringify(await (await getActive()).json())
  // Server-render exactly what a visitor's browser receives; the client components need a session provider to render.
  const html = (node: ReactNode) => renderToStaticMarkup(createElement(SessionProvider, { session: null } as ComponentProps<typeof SessionProvider>, node))
  const page = html(await OpinionDebatePage())
  const home = html(await HomePage({ searchParams: Promise.resolve({}) }))
  const history = (await (await getHistory()).json()) as Served['history']
  const stats = (await (await getStats()).json()) as Served['stats']
  return { active, page, home, history, stats }
}
/**
 * What must not be served when the given side(s) are not public. The debate surfaces (/opinion-debate and the active
 * API) must show NEITHER side and not the debate itself. The homepage also lists ordinary articles, where a side that
 * is still public on its own legitimately appears, so there only the broken side(s) and the debate itself are checked.
 */
function leaks(s: Served, fx: Fx, broken: Array<'for' | 'against'>): string[] {
  const brokenSecrets = broken.flatMap((b) => fx.side[b])
  const both = [...fx.side.for, ...fx.side.against]
  const check = (surface: 'active' | 'page' | 'home', list: string[]) => list.filter((x) => s[surface].includes(x)).map((x) => `${surface} leaks ${x}`)
  return [...check('active', [...both, ...fx.own]), ...check('page', [...both, ...fx.own]), ...check('home', [...brokenSecrets, ...fx.own])]
}
/** A public debate is served with both sides, on all three renderings (ids are not rendered, so they are not checked). */
function knows(s: Served, fx: Fx): string[] {
  const shown = [...fx.side.for, ...fx.side.against, ...fx.own]
  const ids = new Set([fx.forArticle.id, fx.againstArticle.id])
  return (['active', 'page', 'home'] as const).flatMap((k) => shown.filter((x) => !ids.has(x) && !s[k].includes(x)).map((x) => `${k} is missing ${x}`))
}

/** Every row a public read must leave alone, including updatedAt. */
async function rowsSnapshot(fx: Fx) {
  const ids = [fx.forArticle.id, fx.againstArticle.id]
  return JSON.stringify({
    articles: await db.article.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, status: true, deletedAt: true, hiddenByDebateAt: true, scheduledAt: true, publishedAt: true, updatedAt: true } }),
    debate: await db.debate.findUnique({ where: { id: fx.debate.id } }),
    votes: await db.debateVote.count({ where: { debateId: fx.debate.id } }),
    audits: await db.auditLog.count({ where: { targetId: fx.debate.id } }),
  })
}

suite('public debate visibility fails closed (real database, real handlers and pages)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as Db
    state.prisma = db
    const mk = (label: string, role: 'ADMIN' | 'READER') => db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `${label} ${tag}`, role, emailVerified: new Date() } })
    people.admin = (await mk('admin', 'ADMIN')).id
    people.voter = (await mk('voter', 'READER')).id
    people.voter2 = (await mk('voter2', 'READER')).id
    people.voter3 = (await mk('voter3', 'READER')).id
    // "The active debate" is whichever active row the database returns first: make ours the only one for the
    // duration of this file, and put the seed data back afterwards.
    deactivated = (await db.debate.findMany({ where: { isActive: true }, select: { id: true } })).map((d) => d.id)
    await db.debate.updateMany({ where: { id: { in: deactivated } }, data: { isActive: false } })
  })
  afterAll(async () => {
    await db.debate.updateMany({ where: { id: { in: deactivated } }, data: { isActive: true } })
    const ours = await db.debate.findMany({ where: { title: { startsWith: tag } }, select: { id: true } })
    await db.debateVote.deleteMany({ where: { OR: [{ debateId: { in: ours.map((d) => d.id) } }, { userId: { in: Object.values(people) } }] } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: ours.map((d) => d.id) } }, { performedBy: { in: Object.values(people) } }] } })
    await db.debate.deleteMany({ where: { title: { startsWith: tag } } })
    await db.article.deleteMany({ where: { slug: { startsWith: tag } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('positive control: a fully public debate is served everywhere, accepts exactly one vote per member, and shows in the history and statistics', async () => {
    const fx = await makeDebate()
    try {
      state.session = { id: people.voter }
      const before = await serve()
      expect(knows(before, fx)).toEqual([])
      expect(before.history).toEqual([])

      expect((await vote(fx.debate.id)).status).toBe(200)
      expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(1)
      expect((await vote(fx.debate.id)).status).toBe(409) // one vote per member, unchanged
      expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(1)

      const after = await serve()
      expect(after.history.map((h) => h.debate.id)).toEqual([fx.debate.id])
      expect(after.stats.totalDebateVotes).toBe(after.history.length)
    } finally { await fx.cleanup() }
  })

  for (const side of ['forArticle', 'againstArticle'] as const) {
    for (const bad of NON_PUBLIC) {
      it(`${side} ${PRETTY[bad]}: the whole debate disappears from every surface, the vote is refused, the old vote is kept but hidden, nothing is written, and editorial restoration brings it back`, async () => {
        const fx = await makeDebate()
        try {
          // A member voted while the debate was public.
          state.session = { id: people.voter }
          expect((await vote(fx.debate.id)).status).toBe(200)
          const visible = await serve()
          expect(knows(visible, fx)).toEqual([])
          expect(visible.history.map((h) => h.debate.id)).toEqual([fx.debate.id])
          const baselineStats = visible.stats.totalDebateVotes

          // One argument leaves public view by an editorial action or a legacy state.
          await setState(fx[side].id, bad, fx)
          const articleRowsBefore = await rowsSnapshot(fx)

          const hidden = await serve()
          const brokenSide = side === 'forArticle' ? 'for' : 'against'
          expect(leaks(hidden, fx, [brokenSide])).toEqual([]) // title/excerpt/slug/author/id, HTML and JSON
          expect(hidden.history.map((h) => h.debate.id)).not.toContain(fx.debate.id)
          expect(JSON.stringify(hidden.history)).not.toMatch(/Title dpv|Excerpt dpv/)
          expect(hidden.stats.totalDebateVotes).toBe(hidden.history.length) // statistics agree with the filtered history
          expect(hidden.stats.totalDebateVotes).toBe(baselineStats - 1)

          // A different member cannot vote, and a refused vote writes nothing.
          state.session = { id: people.voter2 }
          const refused = await vote(fx.debate.id)
          expect(refused.status).toBe(404)
          expect(JSON.stringify(await refused.json())).not.toMatch(/Title|Excerpt/)
          state.session = null
          state.anon = `anon-${tag}-${counter}`
          expect((await vote(fx.debate.id, 'AGAINST')).status).toBe(404)
          state.anon = undefined
          expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(1) // the original vote is still stored

          // Reading and refusing changed no row anywhere.
          expect(await rowsSnapshot(fx)).toBe(articleRowsBefore)

          // The editor legitimately publishes the article again: the debate and the old vote return.
          state.session = { id: people.voter }
          await restore(fx[side].id, bad)
          const back = await serve()
          expect(knows(back, fx)).toEqual([])
          expect(back.history.map((h) => h.debate.id)).toEqual([fx.debate.id])
          expect(back.stats.totalDebateVotes).toBe(back.history.length)
          state.session = { id: people.voter2 }
          expect((await vote(fx.debate.id, 'AGAINST')).status).toBe(200) // voting works again
        } finally { state.session = null; state.anon = undefined; await fx.cleanup() }
      })
    }
  }

  it('the administrators\' diagnostic view still shows the whole debate, its articles\' real states, its stored votes and the warning, and reading it republishes nothing', async () => {
    const fx = await makeDebate()
    try {
      state.session = { id: people.voter }
      expect((await vote(fx.debate.id)).status).toBe(200)
      await setState(fx.forArticle.id, 'TRASHED', fx)
      await setState(fx.againstArticle.id, 'ARCHIVED', fx)
      // Not public...
      expect(leaks(await serve(), fx, ['for', 'against'])).toEqual([])
      // ...but the admin list is unfiltered: nothing is hidden from the people who have to fix it.
      const before = await rowsSnapshot(fx)
      const row = (await loadDebateAdminRows()).find((r) => r.id === fx.debate.id)
      expect(row).toBeDefined()
      expect(row!.visibility).toBe('published') // the debate's own lifecycle state is unchanged
      expect(row!.articles.map((a) => [a.side, a.title, a.status, a.trashed])).toEqual([
        ['FOR', fx.side.for[0], 'ARCHIVED', true],
        ['AGAINST', fx.side.against[0], 'ARCHIVED', false],
      ])
      expect(row!.votes.total).toBe(1) // the stored vote is still counted for administrators
      expect(row!.outOfSync).toMatch(/not public/)
      expect(await rowsSnapshot(fx)).toBe(before) // neither the public reads nor the admin read changed or republished anything
    } finally { state.session = null; await fx.cleanup() }
  })

  it('both arguments non-public at once (one archived, one trashed) is still absent', async () => {
    const fx = await makeDebate()
    try {
      await setState(fx.forArticle.id, 'ARCHIVED', fx)
      await setState(fx.againstArticle.id, 'TRASHED', fx)
      state.session = { id: people.voter }
      expect(leaks(await serve(), fx, ['for', 'against'])).toEqual([])
    } finally { state.session = null; await fx.cleanup() }
  })

  it('a debate that is itself unpublished or deleted stays absent and unvotable, whatever its articles say', async () => {
    for (const own of [{ unpublishedAt: new Date() }, { deletedAt: new Date(), unpublishedAt: new Date() }]) {
      const fx = await makeDebate(own)
      try {
        state.session = { id: people.voter }
        expect(leaks(await serve(), fx, ['for', 'against'])).toEqual([])
        expect((await vote(fx.debate.id)).status).toBe(404)
        expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(0)
      } finally { state.session = null; await fx.cleanup() }
    }
  })

  it('a debate whose article relation cannot be resolved is excluded without breaking the valid debate beside it', async () => {
    const c = new Client({ connectionString: TEST_DB! })
    await c.connect()
    let canBypass = true
    try { await c.query('SET session_replication_role = replica') } catch { canBypass = false }
    if (!canBypass) { await c.end(); console.warn('[debate-public-visibility-db] dangling-relation case needs a superuser to bypass the foreign key: NOT RUN'); return }
    const good = await makeDebate({ isActive: false })
    const id = `${tag}-dangling`
    try {
      // Foreign keys off for this one connection only: a debate that points at articles that do not exist.
      await c.query(`INSERT INTO debates (id, title, "forArticleId", "againstArticleId", "isActive", "updatedAt") VALUES ($1, $2, 'missing-for', 'missing-against', true, now())`, [id, `${tag} dangling`])
      state.session = { id: people.voter }
      const served = await serve()
      expect(served.active).toBe('null')
      expect(served.page).not.toContain(`${tag} dangling`)
      // The valid debate beside it is still rendered (it is inactive, so it sits under past debates).
      expect(served.page).toContain(good.forArticle.slug ? `Title ${tag}` : '')
      expect(served.page).toContain(good.side.for[0])
      expect((await vote(id)).status).toBe(404)
      expect(await db.debateVote.count({ where: { debateId: id } })).toBe(0)
      expect((await db.debate.count({ where: publicDebateWhere({ id }) }))).toBe(0)
    } finally {
      await c.query('DELETE FROM debates WHERE id = $1', [id])
      await c.end()
      state.session = null
      await good.cleanup()
    }
  })

  describe('a vote is atomic with the visibility rule', () => {
    const settle = async <T,>(p: Promise<T>, ms: number) => Promise.race([p.then((v) => ({ done: true as const, v })), new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), ms))])

    it('an article taken out of view and COMMITTED before the vote writes is respected: the vote is refused', async () => {
      const fx = await makeDebate()
      const c = new Client({ connectionString: TEST_DB! })
      await c.connect()
      try {
        state.session = { id: people.voter }
        await c.query('BEGIN')
        await c.query(`UPDATE articles SET status = 'ARCHIVED' WHERE id = $1`, [fx.forArticle.id]) // editor action, not yet committed
        const racing = vote(fx.debate.id)
        expect((await settle(racing, 600)).done).toBe(false) // the vote waits on the locked article instead of sneaking past it
        await c.query('COMMIT')
        expect((await racing).status).toBe(404)
        expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(0)
      } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); state.session = null; await fx.cleanup() }
    })

    it('a vote that got there first is stored, the change then applies, and the stored vote is not shown', async () => {
      const fx = await makeDebate()
      const c = new Client({ connectionString: TEST_DB! })
      await c.connect()
      try {
        let release!: () => void
        const gate = new Promise<void>((r) => { release = r })
        const holding = withPublicDebate(fx.debate.id, async (tx) => {
          await tx.debateVote.create({ data: { debateId: fx.debate.id, userId: people.voter, side: 'FOR' } })
          await gate
          return 'voted'
        })
        await new Promise((r) => setTimeout(r, 400)) // the vote transaction now holds its locks
        const change = c.query(`UPDATE articles SET status = 'ARCHIVED' WHERE id = $1`, [fx.againstArticle.id])
        expect((await settle(change, 600)).done).toBe(false) // the editorial change cannot slip in mid-vote
        release()
        expect(await holding).toEqual({ visible: true, value: 'voted' })
        await change
        expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(1) // never deleted by the hide
        state.session = { id: people.voter }
        const served = await serve()
        expect(leaks(served, fx, ['against'])).toEqual([])
        expect(served.history).toEqual([])
        expect(served.stats.totalDebateVotes).toBe(0)
      } finally { await c.end(); state.session = null; await fx.cleanup() }
    })

    it('hiding the debate through the real lifecycle keeps its votes, hides them, and publishing it restores both', async () => {
      const fx = await makeDebate()
      try {
        state.session = { id: people.voter }
        expect((await vote(fx.debate.id)).status).toBe(200)
        await transitionDebate({ id: people.admin }, fx.debate.id, 'unpublish')
        expect(await db.debateVote.count({ where: { debateId: fx.debate.id } })).toBe(1)
        const hidden = await serve()
        expect(leaks(hidden, fx, ['for', 'against'])).toEqual([])
        expect(hidden.history).toEqual([])
        expect(hidden.stats.totalDebateVotes).toBe(0)
        await transitionDebate({ id: people.admin }, fx.debate.id, 'publish')
        await db.debate.update({ where: { id: fx.debate.id }, data: { isActive: true } })
        const back = await serve()
        expect(back.history.map((h) => h.debate.id)).toEqual([fx.debate.id])
        expect(back.stats.totalDebateVotes).toBe(1)
      } finally { state.session = null; await fx.cleanup() }
    })
  })

  describe('one rule, never copied; reads are never cached', () => {
    const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
    const all = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const f = join(dir, n)
      return statSync(f).isDirectory() ? all(f) : /\.(ts|tsx)$/.test(n) ? [f] : []
    })

    it('every public surface builds its filter from debateVisibility, and no other file re-spells the debate\'s own conditions', () => {
      for (const file of ['app/opinion-debate/page.tsx', 'app/(home)/page.tsx', 'app/api/debates/active/route.ts', 'app/api/debates/[debateId]/vote/route.ts', 'lib/debateVoting.ts', 'app/api/profile/debate-votes/route.ts', 'app/api/profile/stats/route.ts']) {
        expect(src(file), file).toMatch(/publicDebateWhere|PUBLIC_DEBATE_WHERE/)
      }
      const root = join(process.cwd(), 'src')
      const copies = all(root).filter((f) => /unpublishedAt:\s*null/.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f))
      // The rule lives in debateVisibility.ts. The lifecycle writes that column; nothing else may filter on it.
      expect(copies.filter((f) => f !== 'lib/debateVisibility.ts' && f !== 'lib/debateLifecycle.ts')).toEqual([])
    })

    it('the debate read paths are dynamic and not wrapped in a data cache, so the query IS the invalidation', () => {
      expect(src('app/opinion-debate/page.tsx')).toMatch(/export const dynamic = 'force-dynamic'/)
      expect(src('app/api/debates/active/route.ts')).toMatch(/export const dynamic = 'force-dynamic'/)
      expect(src('app/api/debates/[debateId]/vote/route.ts')).toMatch(/export const dynamic = 'force-dynamic'/)
      expect(src('app/(home)/page.tsx')).toMatch(/export const dynamic = 'force-dynamic'/)
      for (const file of ['app/opinion-debate/page.tsx', 'app/api/debates/active/route.ts', 'app/api/profile/debate-votes/route.ts', 'app/api/profile/stats/route.ts']) {
        expect(src(file), file).not.toMatch(/unstable_cache|export const revalidate\b|'use cache'|revalidate:\s*\d/)
      }
      const home = src('app/(home)/page.tsx')
      expect(home).toMatch(/async function getActiveDebate\(/) // a plain function...
      expect(home).not.toMatch(/getActiveDebate\s*=\s*unstable_cache/) // ...never a cached one
    })

    it('the shared rule is the debate\'s own state AND both articles under the article rule', () => {
      expect(PUBLIC_DEBATE_WHERE.deletedAt).toBeNull()
      expect(PUBLIC_DEBATE_WHERE.unpublishedAt).toBeNull()
      expect(PUBLIC_DEBATE_WHERE.forArticle).toMatchObject({ status: 'PUBLISHED', deletedAt: null })
      expect(PUBLIC_DEBATE_WHERE.againstArticle).toMatchObject({ status: 'PUBLISHED', deletedAt: null })
      // Narrowing is ANDed: a caller can never replace a visibility condition.
      expect(publicDebateWhere({ forArticle: { status: 'ARCHIVED' } })).toEqual({ AND: [PUBLIC_DEBATE_WHERE, { forArticle: { status: 'ARCHIVED' } }] })
    })
  })
})
