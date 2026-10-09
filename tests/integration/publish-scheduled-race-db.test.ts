/**
 * publishScheduledArticles() against a REAL Postgres, with an editor changing the article in
 * the gap between the publisher's initial query and its compare-and-set update.
 *
 * Why: the first query selects due articles (`status SCHEDULED, scheduledAt <= now, deletedAt null`),
 * and the publisher then flips each one with updateMany. Anything an editor does in between is
 * invisible to the first query, so the update must repeat every condition itself. Trashing is the
 * dangerous case: the trash route (DELETE /api/articles/[id]) only sets `deletedAt` and leaves
 * `status = SCHEDULED`, so a status guard alone does not stop a trashed article being published
 * (and emailed, notified and credited) while it sits in the trash. Before #117 the update had no
 * `deletedAt` condition and this happened; #117 added `deletedAt: null` and an `updatedAt` guard.
 *
 * The interleaving is deterministic: findMany is wrapped so the editor's change lands after it
 * returns its rows and before the update runs, exactly the window a real editor would hit.
 *
 * Article.updatedAt is @updatedAt, so ordinary Prisma writes also trip the updatedAt guard. The
 * "do not move updatedAt" cases hold it constant so deletedAt, status and scheduledAt are each
 * proven necessary on their own: removing any one of the four conditions fails a test.
 *
 * DESTRUCTIVE (empties articles, notifications and writer achievements): it skips unless the database
 * name contains "publish_race", and throws (never connects) if that database is on a host the central
 * guard rejects (hosted Supabase, the production project, any non-local host). It never reads
 * DATABASE_URL or .env.local, and it is NOT run by CI, which only runs `test:unit`:
 *
 *   createdb -h 127.0.0.1 -p 5433 -U postgres -T template0 consilium_publish_race_test
 *   TEST_HARNESS=1 DATABASE_URL=postgresql://postgres@127.0.0.1:5433/consilium_publish_race_test \
 *     DIRECT_URL=postgresql://postgres@127.0.0.1:5433/consilium_publish_race_test npx prisma db push
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/consilium_publish_race_test \
 *     npx vitest run tests/integration/publish-scheduled-race-db.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
const DB_NAME = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, '') : ''

async function ready(): Promise<boolean> {
  if (!TEST_DB || !DB_NAME.includes('publish_race')) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    return (await client.query(`select 1 from information_schema.tables where table_name = 'articles'`)).rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const isReady = await ready()
if (!isReady) console.warn('[publish-scheduled-race-db] skipped: needs TEST_DATABASE_URL pointing at a *publish_race* database with the Prisma schema pushed')
const suite = isReady ? describe : describe.skip

const sendEmail = vi.fn<(m: { to: string; subject: string; html: string }) => Promise<boolean>>()
const revalidate = vi.fn()
let db: PrismaClient
let publishScheduledArticles: typeof import('@/lib/scheduledPublishing').publishScheduledArticles
const tag = `race${Date.now().toString(36)}`
let authorId = ''
let n = 0
const MIN = 60_000

const dueArticle = () => {
  n += 1
  return db.article.create({
    data: { title: `Race ${n}`, slug: `${tag}-${n}`, content: 'body', authorId, status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 5 * MIN) },
  })
}
const row = (id: string) =>
  db.article.findUniqueOrThrow({ where: { id }, select: { status: true, publishedAt: true, scheduledAt: true, deletedAt: true, title: true } })

/** Runs publishScheduledArticles with `interfere` executing after the first query returns, before any update. */
async function publishWith(interfere: () => Promise<unknown>) {
  const original = db.article.findMany.bind(db.article)
  const spy = vi.spyOn(db.article, 'findMany').mockImplementationOnce(((args: never) =>
    original(args).then(async (rows) => {
      await interfere()
      return rows
    })) as never)
  try {
    return await publishScheduledArticles(new Date())
  } finally {
    spy.mockRestore()
  }
}

const noSideEffects = async (articleId: string) => {
  expect(sendEmail).not.toHaveBeenCalled()
  expect(await db.notification.count({ where: { articleId } })).toBe(0)
  expect(revalidate).not.toHaveBeenCalled()
}

suite('publishScheduledArticles vs. an editor changing the article mid-run (real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) }) as unknown as PrismaClient
    vi.doMock('@/lib/prisma', () => ({ prisma: db }))
    vi.doMock('@/lib/email', () => ({
      sendEmail,
      articlePublishedEmail: (title: string) => ({ subject: `Published: ${title}`, html: title }),
    }))
    vi.doMock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: revalidate }))
    ;({ publishScheduledArticles } = await import('@/lib/scheduledPublishing'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    authorId = (await db.user.create({ data: { email: `${tag}@example.test`, name: 'Race Author', role: 'WRITER' } })).id
  })

  beforeEach(async () => {
    sendEmail.mockReset().mockResolvedValue(true)
    revalidate.mockReset()
    await db.writerAchievement.deleteMany({})
    await db.notification.deleteMany({})
    await db.article.deleteMany({})
  })

  afterAll(async () => {
    await db.writerAchievement.deleteMany({})
    await db.notification.deleteMany({})
    await db.article.deleteMany({})
    await db.user.deleteMany({ where: { id: authorId } })
    await db.$disconnect()
  })

  it('control: with no interference a due article is published', async () => {
    const a = await dueArticle()
    const result = await publishWith(async () => {})
    expect(result.published.map((p) => p.id)).toEqual([a.id])
    expect((await row(a.id)).status).toBe('PUBLISHED')
  })

  it('an article moved to the trash after the first query is NOT published, emailed, notified or announced', async () => {
    const a = await dueArticle()
    const result = await publishWith(() => db.article.update({ where: { id: a.id }, data: { deletedAt: new Date() } }))
    const after = await row(a.id)
    expect(after.status).toBe('SCHEDULED') // the trash route leaves status alone
    expect(after.deletedAt).not.toBeNull()
    expect(after.publishedAt).toBeNull()
    expect(result.published).toEqual([])
    expect(result.skipped.map((s) => s.id)).toEqual([a.id])
    await noSideEffects(a.id)
  })

  it('an article pulled back to DRAFT after the first query is not published', async () => {
    const a = await dueArticle()
    const result = await publishWith(() => db.article.update({ where: { id: a.id }, data: { status: 'DRAFT' } }))
    expect((await row(a.id)).status).toBe('DRAFT')
    expect(result.published).toEqual([])
    await noSideEffects(a.id)
  })

  it('an article rescheduled into the future after the first query is not published early', async () => {
    const a = await dueArticle()
    const later = new Date(Date.now() + 60 * MIN)
    const result = await publishWith(() => db.article.update({ where: { id: a.id }, data: { scheduledAt: later } }))
    const after = await row(a.id)
    expect(after.status).toBe('SCHEDULED')
    expect(after.scheduledAt?.toISOString()).toBe(later.toISOString())
    expect(result.published).toEqual([])
    await noSideEffects(a.id)
  })

  // Article.updatedAt is @updatedAt, so every Prisma write above also moves it and the updatedAt guard
  // alone blocks them: the tests above would stay green with deletedAt, status or scheduledAt dropped
  // from the update. These repeat the same changes with updatedAt held at its original value (as a
  // raw-SQL or otherwise non-bumping writer would leave it), so each remaining condition is needed.
  describe('writers that do not move updatedAt', () => {
    it('a trashed article is still not published', async () => {
      const a = await dueArticle()
      const result = await publishWith(() => db.article.update({ where: { id: a.id }, data: { deletedAt: new Date(), updatedAt: a.updatedAt } }))
      const after = await row(a.id)
      expect(after.status).toBe('SCHEDULED')
      expect(after.deletedAt).not.toBeNull()
      expect(after.publishedAt).toBeNull()
      expect(result.published).toEqual([])
      await noSideEffects(a.id)
    })

    it('an article pulled back to DRAFT is still not published', async () => {
      const a = await dueArticle()
      const result = await publishWith(() => db.article.update({ where: { id: a.id }, data: { status: 'DRAFT', updatedAt: a.updatedAt } }))
      expect((await row(a.id)).status).toBe('DRAFT')
      expect(result.published).toEqual([])
      await noSideEffects(a.id)
    })

    it('an article rescheduled into the future is still not published early', async () => {
      const a = await dueArticle()
      const later = new Date(Date.now() + 60 * MIN)
      const result = await publishWith(() => db.article.update({ where: { id: a.id }, data: { scheduledAt: later, updatedAt: a.updatedAt } }))
      const after = await row(a.id)
      expect(after.status).toBe('SCHEDULED')
      expect(after.scheduledAt?.toISOString()).toBe(later.toISOString())
      expect(result.published).toEqual([])
      await noSideEffects(a.id)
    })
  })

  it('an article edited after the first query is skipped this run (no stale announcement), then published, with its new title, on the next', async () => {
    const a = await dueArticle()
    const first = await publishWith(() => db.article.update({ where: { id: a.id }, data: { title: 'Corrected headline' } }))
    expect(first.published).toEqual([])
    expect(first.skipped.map((s) => s.id)).toEqual([a.id])
    expect((await row(a.id)).status).toBe('SCHEDULED')
    await noSideEffects(a.id)

    const second = await publishScheduledArticles(new Date())
    expect(second.published.map((p) => p.title)).toEqual(['Corrected headline'])
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0].subject).toContain('Corrected headline')
  })

  it('the trashed article never publishes later either: it stays out of every subsequent run', async () => {
    const a = await dueArticle()
    await publishWith(() => db.article.update({ where: { id: a.id }, data: { deletedAt: new Date() } }))
    for (let i = 0; i < 3; i++) expect((await publishScheduledArticles(new Date())).dueCount).toBe(0)
    expect((await row(a.id)).publishedAt).toBeNull()
    await noSideEffects(a.id)
  })
})
