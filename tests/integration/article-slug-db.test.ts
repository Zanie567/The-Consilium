/**
 * Permanent article addresses and the approved slug migration against real PostgreSQL, with the real
 * migration 20261024120000 (column, table, triggers). Synthetic fixtures only; all are removed afterwards.
 *
 * What must hold:
 *   - publishing locks the address (whichever code or SQL publishes), and unpublishing does not unlock it;
 *   - a locked address cannot be changed by anything except the approved migration, not even raw SQL;
 *   - the migration has a dry run, refuses a stale or wrong approval code and non-administrators, is all or
 *     nothing, changes only the slug (id, dates, content, counters, comments, corrections untouched), and
 *     records a permanent redirect and an audit entry per article;
 *   - a retired address can never be taken by another article, and redirect rows cannot be edited or deleted
 *     (except with the article itself, on permanent deletion);
 *   - redirects resolve to the current address of public articles only; the sitemap lists only current ones;
 *   - the migration file is repeatable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
const MIGRATION = 'supabase/migrations/20261024120000_article_slug_redirects.sql'

async function ready(): Promise<boolean> {
  if (!TEST_DB) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(`select 1 from pg_trigger where tgname = 'articles_slug_guard'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}
const isReady = await ready()
if (!isReady && process.env.E2E_ISOLATED === '1') throw new Error('articles_slug_guard is not installed in the isolated test database')
if (!isReady) console.warn('[article-slug-db] skipped: migration 20261024120000 is not applied to this database')
const suite = isReady ? describe : describe.skip

const cache = await vi.hoisted(async () => (await import('../helpers/fakeNextCache')).createFakeNextCache())
vi.mock('next/cache', () => ({ unstable_cache: cache.unstable_cache, revalidateTag: cache.revalidateTag, revalidatePath: cache.revalidatePath }))

import { applySlugMigration, checkSlugMigration, type SlugMigrationPlan } from '@/lib/articleSlugMigration'
import { findArticleRedirect, loadArticleRedirectMap } from '@/lib/articleRedirects'
import { isSlugAvailable } from '@/lib/articleSlug'
import { loadSitemapData } from '@/lib/publicFeeds'

let db: PrismaClient
const tag = `slugdb-${Date.now().toString(36)}`
const ids = { admin: '', editor: '', writer: '' }
const created: string[] = []
const PUBLISHED_AT = new Date('2026-10-23T08:00:08.610Z')

async function article(over: Record<string, unknown> = {}) {
  const row = await db.article.create({
    data: {
      title: `${tag} ${created.length} title`, slug: `draft-${Date.now()}${created.length}`, content: '{"type":"doc"}',
      authorId: ids.writer, status: 'PUBLISHED', publishedAt: PUBLISHED_AT, viewCount: 42, ...over,
    },
  })
  created.push(row.id)
  return row
}
const sql = (query: string, params: unknown[] = []) => db.$executeRawUnsafe(query, ...params)

suite('article addresses against PostgreSQL', () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) })
    for (const role of ['ADMIN', 'EDITOR', 'WRITER'] as const) {
      const user = await db.user.create({ data: { email: `${tag}-${role.toLowerCase()}@example.test`, name: `${tag} ${role}`, role } })
      ids[role.toLowerCase() as keyof typeof ids] = user.id
    }
  })

  afterAll(async () => {
    if (!db) return
    // Deleting the article cascades to its redirect rows (the only deletion the guard allows).
    await db.article.deleteMany({ where: { id: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
    await db.$disconnect()
  })

  describe('the lock', () => {
    it('is set when an article is published, by any path, and survives unpublishing', async () => {
      const a = await article({ status: 'DRAFT', publishedAt: null })
      expect(a.slugLockedAt).toBeNull()
      await sql(`UPDATE articles SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`, [a.id])
      const locked = (await db.article.findUniqueOrThrow({ where: { id: a.id } })).slugLockedAt
      expect(locked).toBeInstanceOf(Date)
      await sql(`UPDATE articles SET status = 'DRAFT', "publishedAt" = NULL, "slugLockedAt" = NULL WHERE id = $1`, [a.id])
      expect((await db.article.findUniqueOrThrow({ where: { id: a.id } })).slugLockedAt).toEqual(locked)
    })

    it('refuses any slug change on a locked article, even raw SQL, even after unpublishing', async () => {
      const a = await article()
      await expect(db.article.update({ where: { id: a.id }, data: { slug: `${tag}-renamed` } })).rejects.toThrow(/ARTICLE_SLUG_LOCKED/)
      await sql(`UPDATE articles SET status = 'DRAFT' WHERE id = $1`, [a.id])
      await expect(sql(`UPDATE articles SET slug = $2 WHERE id = $1`, [a.id, `${tag}-renamed`])).rejects.toThrow(/ARTICLE_SLUG_LOCKED/)
    })

    it('leaves a never-published draft free to change', async () => {
      const a = await article({ status: 'DRAFT', publishedAt: null })
      await db.article.update({ where: { id: a.id }, data: { slug: `${tag}-draft-choice` } })
      expect((await db.article.findUniqueOrThrow({ where: { id: a.id } })).slug).toBe(`${tag}-draft-choice`)
    })
  })

  describe('the approved migration', () => {
    let target: Awaited<ReturnType<typeof article>>
    let plan: SlugMigrationPlan
    const to = `${tag}-will-si-stocks-make-you-rich-in-2026`

    beforeAll(async () => {
      target = await article({ title: 'Will SI stocks make you rich in 2026?' })
      await db.articleComment.create({ data: { articleId: target.id, authorId: ids.editor, commentText: 'Editorial note' } })
      plan = { id: `${tag}-launch`, entries: [{ articleId: target.id, from: target.slug, to, title: target.title }] }
    })

    it('dry run reports every problem and returns no code', async () => {
      const other = await article({ slug: `${tag}-taken` })
      const bad = await checkSlugMigration(db, {
        id: `${tag}-bad`,
        entries: [
          { articleId: target.id, from: 'not-its-slug', to: other.slug },
          { articleId: 'missing', from: 'x-y-z', to: 'Not Clean' },
        ],
      })
      expect(bad.ok).toBe(false)
      expect(bad.approvalCode).toBeNull()
      const problems = bad.entries.flatMap((e) => e.problems).join('\n')
      expect(problems).toMatch(/current address is/)
      expect(problems).toMatch(/already used by another article/)
      expect(problems).toMatch(/No article has this id/)
      expect(problems).toMatch(/written exactly as/)
    })

    it('blocks while a correction is pending (it was prepared against the current address)', async () => {
      const a = await article()
      await sql(`INSERT INTO article_corrections (id, "articleId", type, status, "publicNote", "baseVersion", proposed, "requestKey", "createdById", "updatedAt")
                 VALUES ($1, $2, 'CORRECTION', 'PENDING', 'note', 'v', '{}'::jsonb, $1, $3, now())`, [`${tag}-corr`, a.id, ids.editor])
      const check = await checkSlugMigration(db, { id: `${tag}-pending`, entries: [{ articleId: a.id, from: a.slug, to: `${tag}-pending-new` }] })
      expect(check.ok).toBe(false)
      expect(check.entries[0].problems.join()).toMatch(/correction is awaiting approval/)
      await sql(`UPDATE article_corrections SET status = 'WITHDRAWN', "withdrawnAt" = now(), "withdrawnById" = $2 WHERE id = $1`, [`${tag}-corr`, ids.editor])
    })

    it('refuses a wrong code and a non-administrator, changing nothing', async () => {
      const check = await checkSlugMigration(db, plan)
      expect(check.ok).toBe(true)
      await expect(applySlugMigration(db, plan, { approvalCode: 'wrong', adminEmail: `${tag}-admin@example.test` })).rejects.toThrow(/Approval code mismatch/)
      await expect(applySlugMigration(db, plan, { approvalCode: check.approvalCode!, adminEmail: `${tag}-editor@example.test` })).rejects.toThrow(/Only an active administrator/)
      expect((await db.article.findUniqueOrThrow({ where: { id: target.id } })).slug).toBe(target.slug)
      expect(await db.articleSlugRedirect.count({ where: { articleId: target.id } })).toBe(0)
    })

    it('refuses a code from before the article changed', async () => {
      const check = await checkSlugMigration(db, plan)
      await sql(`UPDATE articles SET "updatedAt" = now() WHERE id = $1`, [target.id])
      await expect(applySlugMigration(db, plan, { approvalCode: check.approvalCode!, adminEmail: `${tag}-admin@example.test` })).rejects.toThrow(/changed since the dry run/)
    })

    it('applies: only the slug changes, a permanent redirect and an audit entry are recorded', async () => {
      const before = await db.article.findUniqueOrThrow({ where: { id: target.id }, include: { _count: { select: { articleComments: true, views: true, corrections: true } } } })
      const check = await checkSlugMigration(db, plan)
      const result = await applySlugMigration(db, plan, { approvalCode: check.approvalCode!, adminEmail: `${tag}-admin@example.test` })
      expect(result.changed).toEqual([{ articleId: target.id, from: target.slug, to }])

      const after = await db.article.findUniqueOrThrow({ where: { id: target.id }, include: { _count: { select: { articleComments: true, views: true, corrections: true } } } })
      expect(after.slug).toBe(to)
      const { slug: _a, ...restBefore } = before
      const { slug: _b, ...restAfter } = after
      expect(restAfter).toEqual(restBefore) // id, title, content, author, publishedAt, updatedAt, viewCount, lock, counts
      expect(after._count.articleComments).toBe(1)

      const redirect = await db.articleSlugRedirect.findUniqueOrThrow({ where: { oldSlug: target.slug } })
      expect(redirect).toMatchObject({ articleId: target.id, migrationId: plan.id, createdById: ids.admin })
      const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: target.id, action: 'article.slug_migrated' } })
      expect(audit.metadata).toMatchObject({ before: target.slug, after: to, migrationId: plan.id })
    })

    it('cannot be applied twice', async () => {
      const again = await checkSlugMigration(db, plan)
      expect(again.ok).toBe(false)
      expect(again.entries[0].problems.join()).toMatch(/current address is|already has a redirect/)
    })

    it('the old address resolves to the new one (public articles only) and the sitemap lists only the new one', async () => {
      expect(await findArticleRedirect(target.slug, db)).toBe(to)
      expect((await loadArticleRedirectMap(db)).get(target.slug)).toBe(to)
      const sitemap = (await loadSitemapData(db)).articles.map((a) => a.slug)
      expect(sitemap).toContain(to)
      expect(sitemap).not.toContain(target.slug)

      await sql(`UPDATE articles SET status = 'DRAFT' WHERE id = $1`, [target.id])
      expect(await findArticleRedirect(target.slug, db)).toBeNull()
      expect((await loadSitemapData(db)).articles.map((a) => a.slug)).not.toContain(to)
      await sql(`UPDATE articles SET status = 'PUBLISHED' WHERE id = $1`, [target.id])
    })

    it('a retired address can never be taken by another article', async () => {
      expect(await isSlugAvailable(db, target.slug)).toBe(false)
      await expect(article({ slug: target.slug })).rejects.toThrow(/ARTICLE_SLUG_RETIRED|Unique constraint/)
      const draft = await article({ status: 'DRAFT', publishedAt: null })
      await expect(db.article.update({ where: { id: draft.id }, data: { slug: target.slug } })).rejects.toThrow(/ARTICLE_SLUG_RETIRED/)
    })

    it('redirect rows are permanent: no direct update or delete, and none may shadow a live address', async () => {
      await expect(sql(`UPDATE article_slug_redirects SET "oldSlug" = 'other-slug' WHERE "articleId" = $1`, [target.id])).rejects.toThrow(/ARTICLE_REDIRECT_PROTECTED/)
      await expect(sql(`DELETE FROM article_slug_redirects WHERE "articleId" = $1`, [target.id])).rejects.toThrow(/ARTICLE_REDIRECT_PROTECTED/)
      const live = await article({ slug: `${tag}-live` })
      // Through Prisma this surfaces as a unique-constraint error (SQLSTATE 23505); the raw message names the guard.
      await expect(db.articleSlugRedirect.create({ data: { oldSlug: live.slug, articleId: target.id, migrationId: 'x', createdById: ids.admin } }))
        .rejects.toThrow(/Unique constraint/)
      const client = new Client({ connectionString: TEST_DB })
      await client.connect()
      try {
        await expect(client.query(`INSERT INTO article_slug_redirects (id, "oldSlug", "articleId", "migrationId", "createdById") VALUES ('x', $1, $2, 'x', $3)`, [live.slug, target.id, ids.admin]))
          .rejects.toThrow(/ARTICLE_REDIRECT_SHADOWED/)
      } finally {
        await client.end()
      }
    })

    it('permanently deleting the article removes its redirects with it', async () => {
      const gone = await article()
      const check = await checkSlugMigration(db, { id: `${tag}-gone`, entries: [{ articleId: gone.id, from: gone.slug, to: `${tag}-gone-new` }] })
      await applySlugMigration(db, { id: `${tag}-gone`, entries: [{ articleId: gone.id, from: gone.slug, to: `${tag}-gone-new` }] }, { approvalCode: check.approvalCode!, adminEmail: `${tag}-admin@example.test` })
      await db.article.delete({ where: { id: gone.id } })
      expect(await db.articleSlugRedirect.count({ where: { oldSlug: gone.slug } })).toBe(0)
    })
  })

  it('the migration file is repeatable and never moves an existing lock', async () => {
    const a = await article()
    const lockedBefore = (await db.article.findUniqueOrThrow({ where: { id: a.id } })).slugLockedAt
    const client = new Client({ connectionString: TEST_DB })
    await client.connect()
    try {
      await client.query(readFileSync(MIGRATION, 'utf8'))
    } finally {
      await client.end()
    }
    expect((await db.article.findUniqueOrThrow({ where: { id: a.id } })).slugLockedAt).toEqual(lockedBefore)
  })
})
