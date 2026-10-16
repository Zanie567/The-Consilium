/**
 * "Read their articles" on Meet the Team against a REAL Postgres: `loadPublicTeam`, Prisma,
 * `publishedArticleWhere` (including hidden debates) and the articles_hidden_debate_guard
 * trigger are all real. The link follows published authorship only — never role, title,
 * placement or permission — and never exposes an account that has not published.
 *
 * Every fixture carries `tag` and is removed afterwards. Runs only under the isolated
 * launcher (RUN_VITEST=1 npm run test:e2e), see DB_BACKED_SUITES in vitest.config.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient, type ArticleStatus, type Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
if (!TEST_DB) throw new Error('TEST_DATABASE_URL is required: run through the isolated launcher')
assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')

// The real client, wrapped only to record which model queries the loader makes and, for one
// test, to make the publication lookup fail.
const { state } = vi.hoisted(() => ({
  state: { prisma: undefined as unknown, calls: [] as string[], failPublishedLookup: false },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, {
    get: (_target, model: string) => {
      const delegate = (state.prisma as Record<string, Record<string, (...args: unknown[]) => unknown>>)[model]
      return new Proxy(delegate, {
        get: (target, method: string) => (...args: unknown[]) => {
          state.calls.push(`${model}.${method}`)
          const where = (args[0] as { where?: { articles?: unknown } } | undefined)?.where
          if (state.failPublishedLookup && model === 'user' && where?.articles) {
            return Promise.reject(new Error('connection reset'))
          }
          return target[method](...args)
        },
      })
    },
  }),
}))

import { loadPublicTeam } from '@/lib/publicTeam'
import { buildTeamMasthead } from '@/lib/teamHierarchy'

let db: PrismaClient
const tag = `tal-${Date.now()}`
let n = 0

async function person(label: string, role: Role, card: Record<string, unknown> | null, user: Record<string, unknown> = {}) {
  n++
  const account = await db.user.create({
    data: { email: `${tag}-${label}-${n}@ed.ac.uk`, name: `${tag} ${label}`, role, emailVerified: new Date(), slug: null, ...user },
  })
  const profile = card
    ? await db.teamMember.create({
        data: { name: `${tag} ${label}`, role: 'Writer', bio: 'A real biography.', order: n, isActive: true, userId: account.id, ...card },
      })
    : null
  return { account, card: profile }
}
async function article(authorId: string, status: ArticleStatus, extra: Record<string, unknown> = {}) {
  n++
  return db.article.create({
    data: {
      title: `${tag} article ${n}`, slug: `${tag}-article-${n}`, content: '<p>Body</p>', authorId, status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null, ...extra,
    },
  })
}
async function roster() {
  return (await loadPublicTeam()).filter((m) => m.name.startsWith(tag))
}
const linkOf = async (cardId: string) => (await roster()).find((m) => m.id === cardId)?.authorPage

describe('Meet the Team author links (real database)', () => {
  beforeAll(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }), omit: { user: { password: true } } }) as unknown as PrismaClient
    state.prisma = db
  })

  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { startsWith: tag, mode: 'insensitive' } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    const articles = await db.article.findMany({ where: { authorId: { in: userIds } }, select: { id: true } })
    const articleIds = articles.map((a) => a.id)
    await db.debate.deleteMany({ where: { OR: [{ forArticleId: { in: articleIds } }, { againstArticleId: { in: articleIds } }] } })
    await db.article.deleteMany({ where: { id: { in: articleIds } } })
    await db.teamMember.deleteMany({ where: { OR: [{ name: { startsWith: tag } }, { userId: { in: userIds } }] } })
    await db.user.deleteMany({ where: { id: { in: userIds } } })
    await db.$disconnect()
  })

  it('links every published team member, whatever their role, title or placement', async () => {
    const writer = await person('writer', 'WRITER', { role: 'Writer', publicTier: 'writer' }, { slug: `${tag}-writer` })
    const editor = await person('editor', 'EDITOR', { role: 'Senior Editor', publicTier: 'senior_editor' })
    const chief = await person('chief', 'ADMIN', { role: 'Editor-in-Chief', publicTier: 'editor_in_chief' })
    const growth = await person('growth', 'GROWTH', { role: 'Growth & Communications', publicTier: 'growth' })
    for (const p of [writer, editor, chief, growth]) await article(p.account.id, 'PUBLISHED')

    const members = await roster()
    const linkFor = (p: typeof writer) => members.find((m) => m.id === p.card!.id)?.authorPage
    expect(linkFor(writer)).toBe(`/author/${tag}-writer`)
    // No slug: the author page's supported id fallback.
    expect(linkFor(editor)).toBe(`/author/${editor.account.id}`)
    expect(linkFor(chief)).toBe(`/author/${chief.account.id}`)
    expect(linkFor(growth)).toBe(`/author/${growth.account.id}`)

    // Wherever the masthead places them.
    const placed = buildTeamMasthead(members).flatMap((s) => s.rows.flatMap((r) => r.members))
    expect(placed.filter((m) => [writer, editor, chief, growth].some((p) => p.card!.id === m.id)).every((m) => m.authorPage)).toBe(true)
  })

  it('does not link authors whose only articles are unpublished, non-public, deleted or in a hidden debate', async () => {
    const none = await person('none', 'WRITER', {})
    const drafts = await person('drafts', 'WRITER', {})
    await article(drafts.account.id, 'DRAFT')
    await article(drafts.account.id, 'PENDING_REVIEW')
    await article(drafts.account.id, 'SCHEDULED', { scheduledAt: new Date(Date.now() + 86_400_000) })
    const nonPublic = await person('nonpublic', 'EDITOR', { role: 'Editor' })
    await article(nonPublic.account.id, 'REJECTED')
    await article(nonPublic.account.id, 'ARCHIVED')
    await article(nonPublic.account.id, 'PUBLISHED', { deletedAt: new Date() })
    const debater = await person('debater', 'WRITER', {})
    const side = await article(debater.account.id, 'PUBLISHED')
    const otherSide = await article(debater.account.id, 'PUBLISHED')
    const debate = await db.debate.create({ data: { title: `${tag} debate`, forArticleId: side.id, againstArticleId: otherSide.id } })

    expect(await linkOf(debater.card!.id)).toBe(`/author/${debater.account.id}`)
    await db.debate.update({ where: { id: debate.id }, data: { unpublishedAt: new Date() } })
    // Still PUBLISHED rows: only the shared read-side rule hides them.
    expect((await db.article.findUniqueOrThrow({ where: { id: side.id } })).status).toBe('PUBLISHED')

    for (const p of [none, drafts, nonPublic, debater]) expect(await linkOf(p.card!.id)).toBeNull()
  })

  it('never sends an unpublished author’s account id to the public roster', async () => {
    const quiet = await person('quiet', 'WRITER', {})
    const member = (await roster()).find((m) => m.id === quiet.card!.id)!
    expect(JSON.stringify(member)).not.toContain(quiet.account.id)
  })

  it('follows publication and unpublication, and survives a permission change', async () => {
    const p = await person('toggle', 'ADMIN', { role: 'Deputy Editor-in-Chief', publicTier: 'deputy' })
    expect(await linkOf(p.card!.id)).toBeNull()
    const a = await article(p.account.id, 'PUBLISHED')
    expect(await linkOf(p.card!.id)).toBe(`/author/${p.account.id}`)

    await db.user.update({ where: { id: p.account.id }, data: { role: 'READER' } })
    expect(await linkOf(p.card!.id)).toBe(`/author/${p.account.id}`)

    await db.article.update({ where: { id: a.id }, data: { status: 'ARCHIVED' } })
    expect(await linkOf(p.card!.id)).toBeNull()
    await db.article.update({ where: { id: a.id }, data: { status: 'PUBLISHED' } })
    expect(await linkOf(p.card!.id)).toBe(`/author/${p.account.id}`)
  })

  it('keeps hidden profiles hidden and adds no non-team authors', async () => {
    const hidden = await person('hidden', 'WRITER', { isActive: false })
    const outsider = await person('outsider', 'WRITER', null)
    await article(hidden.account.id, 'PUBLISHED')
    await article(outsider.account.id, 'PUBLISHED')
    const names = (await roster()).map((m) => m.name)
    expect(names).not.toContain(`${tag} hidden`)
    expect(names).not.toContain(`${tag} outsider`)
  })

  it('attributes legacy cards only through an unambiguous account email', async () => {
    const kim = await person('kim', 'WRITER', null, { email: `${tag}-kim@ed.ac.uk`, slug: `${tag}-kim` })
    await article(kim.account.id, 'PUBLISHED')
    const legacy = await db.teamMember.create({
      data: { name: `${tag} Kim (legacy)`, role: 'Writer', bio: 'Admin bio.', email: `${tag}-KIM@ed.ac.uk`, order: 900, isActive: true },
    })
    expect(await linkOf(legacy.id)).toBe(`/author/${tag}-kim`)

    // Two accounts whose addresses differ only in case: the card could be either person.
    const twinA = await person('twin', 'WRITER', null, { email: `${tag}-twin@ed.ac.uk` })
    const twinB = await person('twin', 'WRITER', null, { email: `${tag}-TWIN@ed.ac.uk` })
    await article(twinA.account.id, 'PUBLISHED')
    await article(twinB.account.id, 'PUBLISHED')
    const ambiguous = await db.teamMember.create({
      data: { name: `${tag} Twin (legacy)`, role: 'Writer', bio: 'Admin bio.', email: `${tag}-twin@ed.ac.uk`, order: 901, isActive: true },
    })
    expect(await linkOf(ambiguous.id)).toBeNull()

    // A matching name is not an identity.
    const named = await db.teamMember.create({
      data: { name: `${tag} kim`, role: 'Writer', bio: 'Admin bio.', email: null, order: 902, isActive: true },
    })
    expect(await linkOf(named.id)).toBeNull()
  })

  it('gives a legacy card no link when the matching account owns its own (hidden) profile', async () => {
    const owner = await person('owner', 'WRITER', { isActive: false }, { email: `${tag}-owner@ed.ac.uk`, slug: `${tag}-owner` })
    await article(owner.account.id, 'PUBLISHED')
    const legacy = await db.teamMember.create({
      data: { name: `${tag} Owner (legacy)`, role: 'Writer', bio: 'Admin bio.', email: `${tag}-OWNER@ed.ac.uk`, order: 903, isActive: true },
    })
    const members = await roster()
    // Visibility unchanged: the hidden card stays hidden, the legacy card stays listed.
    expect(members.map((m) => m.id)).toContain(legacy.id)
    expect(members.map((m) => m.id)).not.toContain(owner.card!.id)
    const shown = members.find((m) => m.id === legacy.id)!
    expect(shown.authorPage).toBeNull()
    expect(JSON.stringify(shown)).not.toContain(owner.account.id)
  })

  it('decides every link in one query, however many members there are', async () => {
    state.calls = []
    await loadPublicTeam()
    // Roster, legacy email accounts, then one publication lookup for all attributed accounts.
    expect(state.calls).toEqual(['teamMember.findMany', 'user.findMany', 'user.findMany'])
  })

  it('fails visibly, rather than showing nobody as published, when the lookup fails', async () => {
    state.failPublishedLookup = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(loadPublicTeam()).rejects.toThrow('The team roster is unavailable')
    } finally {
      state.failPublishedLookup = false
      error.mockRestore()
    }
  })
})
