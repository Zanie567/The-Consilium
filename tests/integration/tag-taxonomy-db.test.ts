/**
 * The tag taxonomy against real PostgreSQL, with the real migration 20261115120000 (columns, alias and
 * suggestion tables, triggers). Synthetic fixtures only, all removed afterwards.
 *
 * What must hold:
 *   - one wording names one tag: an alias can never share a tag's identity, nor a tag an alias's,
 *     even through raw SQL;
 *   - an article save resolves a name, an alias, or a merged tag's old name to the right tag; a retired
 *     tag stays on articles that have it but cannot be added; only tag managers create tags by saving;
 *   - the article limit is 10, but an older article with more may keep them;
 *   - renaming keeps the slug and the old wording; merging moves every article link and the aliases,
 *     leaves a redirect, and undoing it restores exactly what was there;
 *   - suggestions point to an existing tag when there is one, are recorded once, and approval or
 *     rejection notifies the person who asked;
 *   - the migration file is repeatable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { normalizeArticleTags } from '@/lib/articleTags'
import { discoveryWhere } from '@/lib/discoveryQueries'
import { TagSaveError, resolveArticleTags } from '@/lib/tags/resolve'
import {
  TagManageError, addTagAlias, createTag, listManagedTags, listPendingSuggestions, mergeTags, previewMerge,
  removeTagAlias, renameTag, reviewSuggestion, setTagRetired, suggestTag, undoMerge,
} from '@/lib/tags/manage'

const TEST_DB = process.env.TEST_DATABASE_URL
const MIGRATION = 'supabase/migrations/20261115120000_tag_taxonomy.sql'

async function ready(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(`select 1 from pg_trigger where tgname = 'tag_aliases_guard'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('tag taxonomy migration is not installed in the isolated test database')
if (!isReady) console.warn('[tag-taxonomy-db] skipped: migration 20261115120000 is not applied to this database')
const suite = isReady ? describe : describe.skip

let db: PrismaClient
// Every name in this file starts with the run key, so nothing collides with seeded tags.
const key = `tx${Date.now().toString(36)}`
const N = (label: string) => `${key} ${label}`
const ids = { admin: '', writer: '', other: '' }
const articles: string[] = []
const app = () => db as never

async function article(tagIds: string[] = [], over: Partial<Prisma.ArticleUncheckedCreateInput> = {}) {
  const row = await db.article.create({
    data: {
      title: `${key} article ${articles.length}`, slug: `${key}-a-${articles.length}`, content: '{}', authorId: ids.writer,
      status: 'PUBLISHED', publishedAt: new Date(), ...over,
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
  })
  articles.push(row.id)
  return row
}
const tagsOf = async (articleId: string) =>
  (await db.articleTag.findMany({ where: { articleId }, include: { tag: true } })).map((t) => t.tag.name).sort()

/** The save path: names in, tag rows out, as a manager or not. */
const save = (names: string[], options: { canCreate?: boolean; current?: string[] } = {}) =>
  db.$transaction((tx) => resolveArticleTags(tx, normalizeArticleTags(names), { canCreate: options.canCreate ?? false, currentTagIds: options.current ?? [] }))

suite('tag taxonomy against PostgreSQL', () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) })
    for (const role of ['admin', 'writer', 'other'] as const) {
      const user = await db.user.create({ data: { email: `${key}-${role}@example.test`, name: `${key} ${role}`, role: role === 'admin' ? 'ADMIN' : 'WRITER' } })
      ids[role] = user.id
    }
  })

  afterAll(async () => {
    if (!db) return
    await db.article.deleteMany({ where: { id: { in: articles } } })
    const tags = await db.tag.findMany({ where: { name: { startsWith: key } }, select: { id: true } })
    await db.tagSuggestion.deleteMany({ where: { suggestedById: { in: Object.values(ids) } } })
    await db.tag.updateMany({ where: { id: { in: tags.map((t) => t.id) } }, data: { mergedIntoId: null } })
    await db.tag.deleteMany({ where: { id: { in: tags.map((t) => t.id) } } })
    await db.auditLog.deleteMany({ where: { performedBy: { in: Object.values(ids) } } })
    await db.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } })
    await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
    await db.$disconnect()
  })

  it('the migration can be applied again without changing anything', async () => {
    const client = new Client({ connectionString: TEST_DB })
    await client.connect()
    try {
      await client.query(readFileSync(MIGRATION, 'utf8'))
    } finally {
      await client.end()
    }
  })

  describe('one wording, one tag (database guards)', () => {
    it('refuses an alias that is a tag’s name, and a tag named like an alias, even through raw SQL', async () => {
      const inflation = await createTag(app(), { name: N('Inflation') }, ids.admin)
      await addTagAlias(app(), inflation.id, N('CPI'), ids.admin)
      await expect(db.$executeRawUnsafe(`INSERT INTO tag_aliases (id, "tagId", name, identity) VALUES ($1, $2, $3, 'ignored')`, `${key}-raw`, inflation.id, N('inflation')))
        .rejects.toThrow(/TAG_ALIAS_CONFLICT/)
      await expect(db.tag.create({ data: { name: N('cpi'), slug: `${key}-cpi-raw` } })).rejects.toThrow(/TAG_ALIAS_CONFLICT/)
      // The identity column is derived by the database, never taken from the caller.
      const alias = await db.tagAlias.findFirstOrThrow({ where: { tagId: inflation.id } })
      expect(alias.identity).toBe(`${key}-cpi`)
    })

    it('the service reports which tag already owns a wording', async () => {
      const err = await createTag(app(), { name: `  ${N('INFLATION')} ` }, ids.admin).catch((e) => e)
      expect(err).toBeInstanceOf(TagManageError)
      expect(err).toMatchObject({ code: 'NAME_TAKEN', status: 409, existing: { name: N('Inflation') } })
      const viaAlias = await createTag(app(), { name: N('cpi') }, ids.admin).catch((e) => e)
      expect(viaAlias.message).toMatch(/already another name for/)
    })

    it('two people creating the same tag at once get one tag', async () => {
      const results = await Promise.allSettled([1, 2, 3].map(() => createTag(app(), { name: N('Race Topic') }, ids.admin)))
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await db.tag.count({ where: { name: N('Race Topic') } })).toBe(1)
    })
  })

  describe('saving an article', () => {
    it('resolves names and aliases case-insensitively, and counts two wordings of one tag once', async () => {
      const resolved = await save([N('inflation'), N('CPI'), ` ${N('Inflation')} `])
      expect(resolved.map((t) => t.name)).toEqual([N('Inflation')])
    })

    it('refuses an unknown name from anyone but a tag manager, and writes nothing', async () => {
      const before = await db.tag.count()
      const err = await save([N('Inflation'), N('Brand New Topic')]).catch((e) => e)
      expect(err).toBeInstanceOf(TagSaveError)
      expect(err).toMatchObject({ code: 'TAG_NOT_APPROVED', names: [N('Brand New Topic')] })
      expect(await db.tag.count()).toBe(before)
    })

    it('lets a tag manager create a tag by saving, as before', async () => {
      const [created] = await save([N('Manager Topic')], { canCreate: true })
      expect(await db.tag.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ name: N('Manager Topic'), slug: `${key}-manager-topic` })
    })

    it('keeps a retired tag on an article that has it, but refuses adding it elsewhere', async () => {
      const old = await createTag(app(), { name: N('Retiring') }, ids.admin)
      await setTagRetired(app(), old.id, true, ids.admin)
      expect((await save([N('Retiring')], { current: [old.id] })).map((t) => t.id)).toEqual([old.id])
      await expect(save([N('Retiring')])).rejects.toMatchObject({ code: 'TAG_RETIRED' })
      await setTagRetired(app(), old.id, false, ids.admin)
      expect(await save([N('Retiring')])).toHaveLength(1)
    })

    it('allows 10 tags, refuses 11, but lets an older article keep the 12 it has', async () => {
      const made = []
      for (let i = 0; i < 12; i++) made.push(await createTag(app(), { name: N(`Many ${String.fromCharCode(97 + i)}`) }, ids.admin))
      expect(await save(made.slice(0, 10).map((t) => t.name))).toHaveLength(10)
      await expect(save(made.slice(0, 11).map((t) => t.name))).rejects.toMatchObject({ code: 'TOO_MANY_TAGS' })
      expect(await save(made.map((t) => t.name), { current: made.map((t) => t.id) })).toHaveLength(12)
      await expect(save([...made.map((t) => t.name), N('Inflation')], { current: made.map((t) => t.id) })).rejects.toMatchObject({ code: 'TOO_MANY_TAGS' })
    })
  })

  describe('renaming', () => {
    it('keeps the slug and every article, and keeps the old wording as an alias', async () => {
      const t = await createTag(app(), { name: N('Labor Markets') }, ids.admin)
      const a = await article([t.id])
      const renamed = await renameTag(app(), t.id, N('Labour Markets'), ids.admin)
      expect(renamed).toMatchObject({ id: t.id, slug: t.slug, name: N('Labour Markets') })
      expect(await tagsOf(a.id)).toEqual([N('Labour Markets')])
      expect((await save([N('labor markets')])).map((r) => r.id)).toEqual([t.id])
      // Renaming back onto that alias swaps them rather than refusing.
      await renameTag(app(), t.id, N('Labor Markets'), ids.admin)
      const aliases = (await db.tagAlias.findMany({ where: { tagId: t.id } })).map((x) => x.name)
      expect(aliases).toEqual([N('Labour Markets')])
    })

    it('refuses a name another tag already uses', async () => {
      const t = await createTag(app(), { name: N('Rename Me') }, ids.admin)
      await expect(renameTag(app(), t.id, N('Inflation'), ids.admin)).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    })
  })

  describe('merging', () => {
    it('moves every article and alias, redirects the old tag, and undo restores exactly', async () => {
      const source = await createTag(app(), { name: N('Labour Market') }, ids.admin)
      const target = await createTag(app(), { name: N('Employment') }, ids.admin)
      await addTagAlias(app(), source.id, N('Jobs'), ids.admin)
      const onlySource = await article([source.id])
      const both = await article([source.id, target.id])
      const onlyTarget = await article([target.id])

      expect(await previewMerge(app(), source.id, target.id)).toEqual({ moving: 2, alreadyOnTarget: 1 })
      const merged = await mergeTags(app(), source.id, target.id, ids.admin)
      expect(merged.moved).toBe(2)

      for (const id of [onlySource.id, both.id, onlyTarget.id]) expect(await tagsOf(id)).toEqual([N('Employment')])
      const after = await db.tag.findUniqueOrThrow({ where: { id: source.id }, include: { aliases: true } })
      expect(after.mergedIntoId).toBe(target.id)
      expect(after.retiredAt).not.toBeNull()
      expect(after.slug).toBe(source.slug)
      expect(after.aliases).toEqual([])
      // The old name and its alias both reach the target now.
      expect((await save([N('labour market'), N('jobs')])).map((t) => t.id)).toEqual([target.id])
      // An archive link to the old slug still finds the moved articles.
      const viaOldSlug = await db.article.findMany({ where: { ...discoveryWhere(undefined, undefined, [source.slug]), id: { in: articles } }, select: { id: true } })
      expect(viaOldSlug.map((a) => a.id).sort()).toEqual([onlySource.id, both.id, onlyTarget.id].sort())
      // The dashboard lists it as merged.
      const listed = (await listManagedTags(app())).find((t) => t.id === source.id)!
      expect(listed.mergedInto?.id).toBe(target.id)

      const undone = await undoMerge(app(), source.id, ids.admin)
      expect(undone.restored).toBe(2)
      expect(await tagsOf(onlySource.id)).toEqual([N('Labour Market')])
      expect(await tagsOf(both.id)).toEqual([N('Employment'), N('Labour Market')].sort())
      expect(await tagsOf(onlyTarget.id)).toEqual([N('Employment')])
      const restored = await db.tag.findUniqueOrThrow({ where: { id: source.id }, include: { aliases: true } })
      expect(restored).toMatchObject({ mergedIntoId: null, retiredAt: null })
      expect(restored.aliases.map((a) => a.name)).toEqual([N('Jobs')])
      await expect(undoMerge(app(), source.id, ids.admin)).rejects.toMatchObject({ code: 'NOTHING_TO_UNDO' })
    })

    it('never chains merges, and refuses merging into itself, into a merged tag or into a retired one', async () => {
      const a = await createTag(app(), { name: N('Chain A') }, ids.admin)
      const b = await createTag(app(), { name: N('Chain B') }, ids.admin)
      const c = await createTag(app(), { name: N('Chain C') }, ids.admin)
      await expect(mergeTags(app(), a.id, a.id, ids.admin)).rejects.toMatchObject({ code: 'INVALID_MERGE' })
      await mergeTags(app(), a.id, b.id, ids.admin)
      await expect(mergeTags(app(), c.id, a.id, ids.admin)).rejects.toMatchObject({ code: 'INVALID_MERGE' })
      await mergeTags(app(), b.id, c.id, ids.admin)
      // A, merged into B earlier, now points straight at C.
      expect((await db.tag.findUniqueOrThrow({ where: { id: a.id } })).mergedIntoId).toBe(c.id)
      const r = await createTag(app(), { name: N('Retired Target') }, ids.admin)
      await setTagRetired(app(), r.id, true, ids.admin)
      const d = await createTag(app(), { name: N('Chain D') }, ids.admin)
      await expect(mergeTags(app(), d.id, r.id, ids.admin)).rejects.toMatchObject({ code: 'INVALID_MERGE' })
    })
  })

  describe('aliases', () => {
    it('can be removed without touching any article', async () => {
      const t = await createTag(app(), { name: N('Alias Host') }, ids.admin)
      const a = await article([t.id])
      const alias = await addTagAlias(app(), t.id, N('Host Alias'), ids.admin)
      await removeTagAlias(app(), t.id, alias.id, ids.admin)
      expect(await tagsOf(a.id)).toEqual([N('Alias Host')])
      await expect(save([N('Host Alias')])).rejects.toMatchObject({ code: 'TAG_NOT_APPROVED' })
    })
  })

  describe('suggestions', () => {
    const writer = () => ({ id: ids.writer, role: 'WRITER' })

    it('points to the existing tag when the wording already exists (by name, alias or merged name)', async () => {
      expect(await suggestTag(app(), { name: N('cpi') }, writer())).toEqual({ existing: expect.objectContaining({ name: N('Inflation') }) })
    })

    it('records a new wording once per person, and lists it for review with the article', async () => {
      const own = await article([], { status: 'DRAFT', publishedAt: null })
      const first = await suggestTag(app(), { name: N('Gig Economy'), note: 'Three pieces this term', articleId: own.id }, writer())
      const again = await suggestTag(app(), { name: N('gig economy') }, writer())
      expect('suggestion' in first && 'suggestion' in again && again.suggestion.id === first.suggestion.id).toBe(true)
      const pending = (await listPendingSuggestions(app())).filter((s) => s.name.startsWith(key))
      expect(pending).toEqual([expect.objectContaining({ name: N('Gig Economy'), note: 'Three pieces this term', article: { id: own.id, title: own.title } })])
    })

    it('does not link an article that belongs to someone else', async () => {
      const theirs = await article([], { authorId: ids.other, status: 'DRAFT', publishedAt: null })
      const result = await suggestTag(app(), { name: N('Someone Else Topic'), articleId: theirs.id }, writer())
      const row = await db.tagSuggestion.findUniqueOrThrow({ where: { id: 'suggestion' in result ? result.suggestion.id : '' } })
      expect(row.articleId).toBeNull()
    })

    it('approving creates the tag (under a corrected name), decides every matching request and notifies each person', async () => {
      const myDraft = await article([], { status: 'DRAFT', publishedAt: null })
      const mine = await suggestTag(app(), { name: N('Platform Work'), articleId: myDraft.id }, writer())
      await suggestTag(app(), { name: N('platform work') }, { id: ids.other, role: 'WRITER' })
      const id = 'suggestion' in mine ? mine.suggestion.id : ''
      const result = await reviewSuggestion(app(), id, { action: 'approve', name: N('Platform Economy') }, ids.admin)
      expect(result).toMatchObject({ status: 'APPROVED', decided: 2, tag: { name: N('Platform Economy') } })
      // The suggested wording still finds the approved tag.
      expect((await save([N('platform work')])).map((t) => t.name)).toEqual([N('Platform Economy')])
      const notes = await db.notification.findMany({ where: { type: 'tag_suggestion', userId: { in: [ids.writer, ids.other] } } })
      expect(notes).toHaveLength(2)
      // Each person's notice links only their own article: the other writer never sees this draft's id.
      expect(notes.find((n) => n.userId === ids.writer)?.articleId).toBe(myDraft.id)
      expect(notes.find((n) => n.userId === ids.other)?.articleId).toBeNull()
      await expect(reviewSuggestion(app(), id, { action: 'reject' }, ids.admin)).rejects.toMatchObject({ code: 'ALREADY_REVIEWED' })
    })

    it('"use existing tag" makes the wording an alias; declining creates nothing', async () => {
      const s1 = await suggestTag(app(), { name: N('Price Level') }, writer())
      const inflation = await db.tag.findFirstOrThrow({ where: { name: N('Inflation') } })
      await reviewSuggestion(app(), 'suggestion' in s1 ? s1.suggestion.id : '', { action: 'alias', tagId: inflation.id }, ids.admin)
      expect((await save([N('price level')])).map((t) => t.id)).toEqual([inflation.id])

      const before = await db.tag.count()
      const s2 = await suggestTag(app(), { name: N('Vague Things') }, writer())
      await reviewSuggestion(app(), 'suggestion' in s2 ? s2.suggestion.id : '', { action: 'reject', reason: 'Too broad.' }, ids.admin)
      expect(await db.tag.count()).toBe(before)
      const note = await db.notification.findFirstOrThrow({ where: { userId: ids.writer, title: 'Tag suggestion declined' } })
      expect(note.message).toMatch(/Too broad\./)
    })
  })
})
