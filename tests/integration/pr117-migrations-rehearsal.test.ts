/**
 * Rehearsal of the four PR #117 database migrations on a production-shaped database.
 *
 * HISTORY: on 2026-10-08 production ran the #117 code but none of its four migrations, so the code called
 * two SQL functions that did not exist. The migrations were applied to production on 2026-10-09 and
 * independently verified (docs/remediation/pr117-database-migrations.md). This suite is kept, on purpose,
 * as a regression test: it still proves what applying the migrations does to a pre-#117 database (safe on
 * production-shaped data, additive, replayable, atomic on bad data), and that the application code paths
 * need them. It does NOT touch production and never will; it refuses any non-local server.
 *
 * Baseline: tests/fixtures/pre-pr117-schema.sql, the exact pre-#117 DDL (generated from the Prisma
 * schema at 31a2053) minus article_comments, which production also lacked then. That fixture is
 * intentionally frozen in time: it is NOT a description of production today. Data: 3 clean subscribers,
 * 21 articles, an empty tags table, like production on 2026-10-08.
 *
 * The SQL under docs/remediation/historical/ is exercised here against disposable databases only. The
 * rollback script must keep refusing to run without an explicit acknowledgement (tested below), because
 * on production it would now break the deployed application. docs/remediation/pr117-verify-post-migration.sql
 * is the read-only script to use against production; it is tested here too.
 *
 * Complements tests/integration/upgrade-migrations.test.ts, which uses toy tables. This one uses the
 * real schema, the real application code paths, Supabase-style role privileges, and the rollback.
 *
 * Creates and drops temporary databases, so it is opt-in and refuses any non-local server:
 *
 *   RUN_MIGRATION_REHEARSAL=1 TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres \
 *     npx vitest run tests/integration/pr117-migrations-rehearsal.test.ts
 *
 * What it cannot prove: behaviour on Supabase's own server (Postgres 17 on glibc). The tag-identity
 * function is checked there separately, read-only (tests/unit/tag-identity-production-parity.test.ts).
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { NextRequest } from 'next/server'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { canonicalTagSlug } from '@/lib/tagIdentity'

const ENABLED = process.env.RUN_MIGRATION_REHEARSAL === '1' && Boolean(process.env.TEST_DATABASE_URL)
const suite = ENABLED ? describe : describe.skip
if (!ENABLED) console.warn('[pr117-migrations-rehearsal] skipped: set RUN_MIGRATION_REHEARSAL=1 and TEST_DATABASE_URL (a local server)')
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? ''
if (ENABLED) assertSafeTestDatabaseHost(ADMIN_URL, 'TEST_DATABASE_URL')

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const BASELINE = read('tests/fixtures/pre-pr117-schema.sql')
const ROLLBACK = read('docs/remediation/historical/pr117-rollback-DO-NOT-RUN-IN-PRODUCTION.sql')
const ROLLBACK_ACK = "select set_config('pr117.rollback_acknowledged', 'I-ACCEPT-PRODUCTION-BREAKAGE', false)"
const VERIFY = read('docs/remediation/pr117-verify-post-migration.sql')
const PREFLIGHT = read('docs/remediation/historical/pr117-preflight-PRE-MIGRATION.sql')
const MIGRATIONS = [
  '20261006153514_discovery_topic_identity',
  '20261006160355_managed_article_images',
  '20261006161413_normalized_subscriber_email',
  '20261006161505_article_active_engagement',
]
const migration = (name: string) => read(`supabase/migrations/${name}.sql`)

/**
 * Schema added AFTER PR #117 by later, separately reviewed migrations. The Prisma schema this test compares against
 * describes the application as it is today, so it legitimately contains these columns, and a database that has only
 * the four #117 migrations legitimately lacks them. Each entry names the migration that owns the columns, and a test
 * below proves that migration adds EXACTLY these columns (no more, no fewer), so this list cannot grow to excuse an
 * arbitrary missing column: anything else the #117 migrations fail to provide still fails the assertions.
 * Add an entry here (in migration order) whenever a later migration adds a column the Prisma schema expects.
 */
const LATER_MIGRATIONS: { file: string; adds: string[] }[] = [
  { file: '20261010_debate_lifecycle', adds: ['debates.unpublishedAt', 'debates.deletedAt', 'debates.deletedById'] },
  { file: '20261010_team_member_updated_at', adds: ['team_members.updatedAt'] },
  { file: '20261012100000_article_hidden_by_debate_marker', adds: ['articles.hiddenByDebateAt'] },
]
const LATER_COLUMNS = LATER_MIGRATIONS.flatMap((m) => m.adds).sort()
const API_ROLES = ['anon', 'authenticated', 'service_role']

interface Env {
  client: Client
  url: string
  name: string
}
const createdRoles: string[] = []

/** A fresh, production-shaped database; dropped afterwards. */
async function withDatabase(fn: (env: Env) => Promise<void>, options: { supabaseRoles?: boolean } = {}) {
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  const name = `consilium_rehearsal_${randomUUID().replaceAll('-', '')}`
  const url = new URL(ADMIN_URL)
  url.pathname = `/${name}`
  let client: Client | undefined
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    client = new Client({ connectionString: url.href })
    await client.connect()
    if (options.supabaseRoles) {
      // Roles are cluster-wide. service_role bypasses RLS in Supabase, anon/authenticated do not.
      for (const role of API_ROLES) {
        if (!(await client.query('select 1 from pg_roles where rolname = $1', [role])).rowCount) {
          await client.query(`CREATE ROLE ${role} NOLOGIN`)
          createdRoles.push(role)
        }
        // Set explicitly even when the role already exists (another suite may have left one without it).
        await client.query(`ALTER ROLE ${role} ${role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`)
      }
    }
    await client.query(BASELINE)
    if (options.supabaseRoles) {
      // Supabase's default privileges: new public tables are granted to the API roles.
      await client.query(`GRANT USAGE ON SCHEMA public TO ${API_ROLES.join(', ')};
        GRANT ALL ON ALL TABLES IN SCHEMA public TO ${API_ROLES.join(', ')};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${API_ROLES.join(', ')}`)
    }
    // Production-shaped data: 3 clean subscribers, 21 articles, no tags.
    await client.query(`
      INSERT INTO users (id, email, "updatedAt") VALUES ('author', 'author@example.test', now());
      INSERT INTO articles (id, title, slug, content, "authorId", "updatedAt")
        SELECT 'a' || g, 'Article ' || g, 'article-' || g, 'body', 'author', now() FROM generate_series(1, 21) g;
      INSERT INTO subscribers (id, email) VALUES
        ('s1', 'reader.one@example.test'), ('s2', 'reader.two@example.test'), ('s3', 'reader.three@example.test')`)
    await fn({ client, url: url.href, name })
  } finally {
    await client?.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  }
}

async function applyAll(client: Client) {
  const timings: Record<string, number> = {}
  for (const file of MIGRATIONS) {
    const started = performance.now()
    await client.query(migration(file))
    timings[file] = Math.round(performance.now() - started)
  }
  return timings
}

/** Every `table.column` currently in the public schema. */
async function presentColumns(client: Client): Promise<Set<string>> {
  return new Set(
    (await client.query(`select table_name::text || '.' || column_name::text as k from information_schema.columns where table_schema = 'public'`)).rows.map((r) => r.k as string),
  )
}

/** Columns the deployed Prisma schema expects that this database does not have, sorted, as `table.column`. */
async function missingPrismaColumns(client: Client): Promise<string[]> {
  const present = await presentColumns(client)
  return Prisma.dmmf.datamodel.models
    .flatMap((m) => m.fields.filter((f) => f.kind !== 'object').map((f) => `${m.dbName ?? m.name}.${f.dbName ?? f.name}`))
    .filter((column) => !present.has(column))
    .sort()
}

/** Everything the migrations add or change, as comparable text. */
async function catalog(client: Client) {
  const q = async (sql: string) => (await client.query(sql)).rows.map((r) => Object.values(r).join(' | '))
  return {
    functions: await q(`select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`),
    tables: await q(`select table_name::text from information_schema.tables where table_schema = 'public' order by 1`),
    indexes: await q(`select indexname::text from pg_indexes where schemaname = 'public' order by 1`),
    constraints: await q(`select conrelid::regclass::text || ' ' || conname::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace order by 1`),
  }
}

/** The application's own code, pointed at one database. */
async function loadApp(url: string) {
  vi.resetModules()
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) as unknown as PrismaClient
  vi.doMock('@/lib/prisma', () => ({ prisma: db }))
  const { POST } = await import('@/app/api/subscribe/route')
  const { resolveArticleTag } = await import('@/lib/resolveArticleTag')
  return { db, subscribe: POST, resolveArticleTag }
}
let ipCounter = 0
const subscribeRequest = (email: string) =>
  new NextRequest('https://www.theconsilium.co.uk/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` },
    body: JSON.stringify({ email }),
  })

afterAll(async () => {
  if (!createdRoles.length) return
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  for (const role of createdRoles) await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {})
  await admin.end()
})

suite('PR #117 migrations on a production-shaped database', () => {
  it('BEFORE: the live regression. The deployed code calls functions that do not exist', async () => {
    await withDatabase(async ({ client, url }) => {
      const { db, subscribe, resolveArticleTag } = await loadApp(url)
      try {
        // Newsletter sign-up fails for everyone.
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const res = await subscribe(subscribeRequest('new.reader@example.test'))
        expect(res.status).toBe(500)
        expect((await client.query('select count(*)::int as n from subscribers')).rows[0].n).toBe(3)

        // Saving an article that carries a tag fails for editors.
        await expect(
          db.$transaction((tx) => resolveArticleTag(tx, { name: 'Finance', slug: canonicalTagSlug('Finance') })),
        ).rejects.toThrow(/consilium_tag_identity|does not exist/)
        expect((await client.query('select count(*)::int as n from tags')).rows[0].n).toBe(0)
      } finally {
        vi.restoreAllMocks()
        await db.$disconnect()
      }
    })
  })

  it('applies cleanly, quickly, in timestamp order, and changes no existing row', async () => {
    await withDatabase(async ({ client }) => {
      const before = await catalog(client)
      const rowsBefore = await client.query(
        `select (select count(*) from subscribers)::int s, (select count(*) from articles)::int a, (select count(*) from users)::int u, (select count(*) from tags)::int t`,
      )
      const timings = await applyAll(client)
      for (const [file, ms] of Object.entries(timings)) expect(ms, `${file} took ${ms} ms`).toBeLessThan(2000)

      const after = await catalog(client)
      expect(after.functions.filter((f) => !before.functions.includes(f))).toEqual(['consilium_subscriber_identity', 'consilium_tag_identity'])
      expect(after.tables.filter((t) => !before.tables.includes(t))).toEqual(['article_engagement_sessions', 'article_image_assets'])
      expect(after.indexes.filter((i) => !before.indexes.includes(i))).toEqual([
        'article_engagement_sessions_articleId_startedAt_idx',
        'article_engagement_sessions_pkey',
        'article_engagement_sessions_readerHash_startedAt_idx',
        'article_engagement_sessions_startedAt_idx',
        'article_image_assets_path_key',
        'article_image_assets_pkey',
        'article_image_assets_unusedSince_createdAt_idx',
        'article_image_assets_uploaderId_idx',
        'article_tags_tagId_articleId_idx',
        'subscribers_normalized_email_key',
        'tags_canonical_identity_key',
      ])
      expect(
        (await client.query(`select confdeltype::text d from pg_constraint where conname = 'article_tags_tagId_fkey'`)).rows,
      ).toEqual([{ d: 'r' }]) // was 'c' (CASCADE); now RESTRICT. Exactly one such constraint: replaced, not duplicated.

      expect(
        (await client.query(
          `select (select count(*) from subscribers)::int s, (select count(*) from articles)::int a, (select count(*) from users)::int u, (select count(*) from tags)::int t`,
        )).rows,
      ).toEqual(rowsBefore.rows)
      process.stderr.write(`[rehearsal] migration timings (ms): ${JSON.stringify(timings)}\n`)
    })
  })

  it('can be replayed any number of times with no error and no change', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      const once = await catalog(client)
      await applyAll(client)
      await applyAll(client)
      expect(await catalog(client)).toEqual(once)
    })
  })

  it('AFTER: every column the deployed Prisma schema expects exists, except the separate article_comments gap and the declared later migrations', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      const missing = await missingPrismaColumns(client)
      // The baseline deliberately lacks article_comments (production lacks it): a whole table, nothing else of the kind.
      const commentColumns = missing.filter((m) => m.startsWith('article_comments.'))
      expect(commentColumns.length).toBeGreaterThan(0)
      // Everything else that is missing must be EXACTLY what the declared later migrations add: nothing the #117
      // migrations were supposed to provide, and no declared column that is already there.
      expect(missing.filter((m) => !m.startsWith('article_comments.'))).toEqual(LATER_COLUMNS)
    })
  })

  it('later migrations: each adds exactly the columns declared for it, replays without change, and then nothing is missing', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(read('supabase/migrations/add_article_comments.sql'))
      await client.query(read('supabase/migrations/add_article_comments_quoted_text.sql'))
      for (const { file, adds } of LATER_MIGRATIONS) {
        const before = await presentColumns(client)
        for (const column of adds) expect(before.has(column), `${column} must not exist before ${file}`).toBe(false)
        await client.query(migration(file))
        const after = await presentColumns(client)
        expect([...after].filter((c) => !before.has(c)).sort(), `${file} must add exactly its declared columns`).toEqual([...adds].sort())
        await client.query(migration(file)) // replay: idempotent
        expect(await presentColumns(client)).toEqual(after)
      }
      expect(await missingPrismaColumns(client)).toEqual([])
    }, { supabaseRoles: true }) // add_article_comments.sql grants to the Supabase API roles
  })

  it('AFTER: the real code paths work (newsletter sign-up and tagged article saves)', async () => {
    await withDatabase(async ({ client, url }) => {
      await applyAll(client)
      const { db, subscribe, resolveArticleTag } = await loadApp(url)
      try {
        // sign-up: new -> 201; an existing address in another case/spacing -> already subscribed
        expect((await subscribe(subscribeRequest('new.reader@example.test'))).status).toBe(201)
        const again = await subscribe(subscribeRequest('  New.Reader@Example.Test '))
        expect(again.status).toBe(200)
        expect((await again.json()).message).toBe('Already subscribed')
        expect((await client.query('select count(*)::int as n from subscribers')).rows[0].n).toBe(4)
        // the database itself now refuses a case/whitespace twin that bypasses the route
        await expect(client.query(`insert into subscribers (id, email) values ('twin', ' Reader.One@Example.Test ')`)).rejects.toThrow(/subscribers_normalized_email_key/)

        // tags: the same topic spelled differently resolves to ONE tag, even under concurrency
        const spellings = ['Investment & Finance', ' INVESTMENT---FINANCE ', 'investment finance', 'Investment & Finance', 'investment  &  finance']
        const resolved = await Promise.all(
          spellings.map((name) => db.$transaction((tx) => resolveArticleTag(tx, { name, slug: canonicalTagSlug(name) }))),
        )
        expect(new Set(resolved.map((t) => t.id)).size).toBe(1)
        expect((await client.query('select count(*)::int as n from tags')).rows[0].n).toBe(1)
      } finally {
        await db.$disconnect()
      }
    })
  })

  it('the one behaviour change: deleting a tag that is in use is now refused (RESTRICT), and no code deletes tags', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(`insert into tags (id, name, slug) values ('t1', 'Finance', 'finance'); insert into article_tags ("articleId", "tagId") values ('a1', 't1')`)
      await expect(client.query(`delete from tags where id = 't1'`)).rejects.toThrow(/article_tags_tagId_fkey/)
      await client.query('delete from articles where id = \'a1\'') // the article side still cascades
      expect((await client.query('select count(*)::int as n from article_tags')).rows[0].n).toBe(0)
      await client.query(`delete from tags where id = 't1'`) // unused tags can still be deleted
      const source = readFileSync(join(root, 'src/app/api/articles/[id]/route.ts'), 'utf8') + readFileSync(join(root, 'src/app/api/articles/route.ts'), 'utf8')
      expect(source).not.toMatch(/tag\.delete|tags\.delete/)
    })
  })

  it('refuses bad data atomically: a failed migration leaves nothing behind', async () => {
    await withDatabase(async ({ client }) => {
      await client.query(`insert into tags (id, name, slug) values ('x1', 'Finance & Policy', 'old-1'), ('x2', ' FINANCE POLICY ', 'old-2')`)
      await expect(client.query(migration(MIGRATIONS[0]))).rejects.toThrow('duplicate canonical names')
      await client.query('ROLLBACK')
      expect((await client.query(`select to_regprocedure('public.consilium_tag_identity(text)') as f`)).rows[0].f).toBeNull()
      expect((await client.query(`select count(*)::int as n from pg_indexes where indexname = 'tags_canonical_identity_key'`)).rows[0].n).toBe(0)
      expect((await client.query(`select slug from tags order by id`)).rows).toEqual([{ slug: 'old-1' }, { slug: 'old-2' }])
    })
    await withDatabase(async ({ client }) => {
      await client.query(`insert into tags (id, name, slug) values ('x1', '!!!', 'bang')`)
      await expect(client.query(migration(MIGRATIONS[0]))).rejects.toThrow('empty canonical names')
      await client.query('ROLLBACK')
    })
    await withDatabase(async ({ client }) => {
      await client.query(`insert into subscribers (id, email) values ('d1', 'Twin@example.test'), ('d2', ' twin@example.test\t')`)
      await expect(client.query(migration(MIGRATIONS[2]))).rejects.toThrow('canonical duplicates')
      await client.query('ROLLBACK')
      expect((await client.query(`select to_regprocedure('public.consilium_subscriber_identity(text)') as f`)).rows[0].f).toBeNull()
      expect((await client.query('select count(*)::int as n from subscribers')).rows[0].n).toBe(5)
    })
  })

  it('new tables are server-only under Supabase-style privileges: anon and authenticated are denied, service_role works', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(`insert into article_image_assets (url, path, "uploaderId") values ('u', 'p', 'author'); insert into article_engagement_sessions (id, "articleId") values ('e1', 'a1')`)
      for (const role of ['anon', 'authenticated']) {
        await client.query(`SET ROLE ${role}`)
        try {
          for (const table of ['article_image_assets', 'article_engagement_sessions']) {
            expect((await client.query(`select count(*)::int as n from ${table}`)).rows[0].n, `${role} reads ${table}`).toBe(0)
          }
          await expect(client.query(`insert into article_image_assets (url, path, "uploaderId") values ('x', 'y', 'z')`)).rejects.toThrow(/row-level security/)
        } finally {
          await client.query('RESET ROLE')
        }
      }
      await client.query('SET ROLE service_role')
      try {
        expect((await client.query('select count(*)::int as n from article_image_assets')).rows[0].n).toBe(1)
      } finally {
        await client.query('RESET ROLE')
      }
      // deleting an article cascades its engagement sessions
      await client.query(`delete from articles where id = 'a1'`)
      expect((await client.query('select count(*)::int as n from article_engagement_sessions')).rows[0].n).toBe(0)
    }, { supabaseRoles: true })
  })

  it('the preflight file reads correctly before and after, and returns no row contents', async () => {
    await withDatabase(async ({ client }) => {
      const run = async () => (await client.query(PREFLIGHT)) as unknown as { rows: Record<string, unknown>[] }[]
      const before = await run()
      expect(before[0].rows.filter((r) => String(r.object).startsWith('function') || String(r.object).startsWith('index') || String(r.object).startsWith('table article_image') || String(r.object).startsWith('table article_eng')).every((r) => r.state === 'absent')).toBe(true)
      expect(before[1].rows.map((r) => Number(r.value))).toEqual([0, 0, 0, 0])
      // counts come back as strings (bigint)
      expect(before[2].rows[0]).toMatchObject({ tags: '0', article_tags: '0', subscribers: '3', articles: '21', encoding: 'UTF8' })
      expect(before[3].rows.map((r) => `${r.constraint_name}:${r.delete_rule}`)).toEqual(['article_tags_articleId_fkey:c', 'article_tags_tagId_fkey:c'])
      expect(before[4].rows).toEqual([])
      expect(JSON.stringify(before)).not.toMatch(/example\.test/) // counts and names only

      await applyAll(client)
      const after = await run()
      expect(after[0].rows.filter((r) => !String(r.object).includes('article_comments')).every((r) => r.state === 'present')).toBe(true)
      expect(after[3].rows.map((r) => `${r.constraint_name}:${r.delete_rule}`)).toEqual(['article_tags_articleId_fkey:c', 'article_tags_tagId_fkey:r'])
      expect(after[4].rows.length).toBe(8) // after applying, the "collision" list shows them all: that is how a re-run is recognised
    })
  })

  it('the rollback returns the catalog to its pre-#117 state, loses no data, and the migrations apply again afterwards', async () => {
    await withDatabase(async ({ client }) => {
      const baseline = await catalog(client)
      await applyAll(client)
      expect(await catalog(client)).not.toEqual(baseline)
      await client.query(ROLLBACK_ACK)
      await client.query(ROLLBACK)
      expect(await catalog(client)).toEqual(baseline)
      expect((await client.query(`select confdeltype::text d from pg_constraint where conname = 'article_tags_tagId_fkey'`)).rows).toEqual([{ d: 'c' }])
      expect((await client.query('select count(*)::int as s, (select count(*) from articles)::int as a from subscribers')).rows).toEqual([{ s: 3, a: 21 }])
      await applyAll(client) // round trip
      expect((await catalog(client)).functions).toContain('consilium_tag_identity')
    })
  })

  it('the rollback refuses to drop a table that holds rows unless explicitly forced', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(`insert into article_image_assets (url, path, "uploaderId") values ('u', 'p', 'author')`)
      await client.query(ROLLBACK_ACK)
      await expect(client.query(ROLLBACK)).rejects.toThrow(/Refusing to roll back/)
      await client.query('ROLLBACK')
      expect((await client.query('select count(*)::int as n from article_image_assets')).rows[0].n).toBe(1)
      expect((await catalog(client)).functions).toContain('consilium_tag_identity') // nothing was removed

      await client.query(`select set_config('pr117.rollback_force', 'yes', false)`)
      await client.query(ROLLBACK_ACK)
      await client.query(ROLLBACK)
      expect((await catalog(client)).tables).not.toContain('article_image_assets')
    })
  })

  it('the rollback refuses to run at all without an explicit acknowledgement, even on empty tables, and removes nothing', async () => {
    // Production today: migrated, new tables empty, tags present. An unguarded rollback would pass the
    // old "tables are empty" check and silently break sign-up, tagged saves and uploads.
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(`insert into tags (id, name, slug) values ('t1', 'Finance', 'finance')`)
      const migrated = await catalog(client)
      await expect(client.query(ROLLBACK)).rejects.toThrow(/Refusing to run: this is a historical script/)
      await client.query('ROLLBACK')
      // a wrong acknowledgement is no acknowledgement
      await client.query(`select set_config('pr117.rollback_acknowledged', 'yes', false)`)
      await expect(client.query(ROLLBACK)).rejects.toThrow(/Refusing to run/)
      await client.query('ROLLBACK')
      // the force flag alone must not bypass the acknowledgement
      await client.query(`select set_config('pr117.rollback_force', 'yes', false)`)
      await expect(client.query(ROLLBACK)).rejects.toThrow(/Refusing to run/)
      await client.query('ROLLBACK')
      expect(await catalog(client)).toEqual(migrated)
      expect((await client.query(`select confdeltype::text d from pg_constraint where conname = 'article_tags_tagId_fkey'`)).rows).toEqual([{ d: 'r' }])
      expect((await client.query('select count(*)::int as n from tags')).rows[0].n).toBe(1)
    })
  })

  it('the historical SQL files say, in their own text, that they must not be used against production', () => {
    expect(ROLLBACK).toMatch(/DO NOT RUN AGAINST PRODUCTION/)
    expect(ROLLBACK).toMatch(/I-ACCEPT-PRODUCTION-BREAKAGE/)
    expect(PREFLIGHT).toMatch(/HISTORICAL/)
    expect(PREFLIGHT).toMatch(/pr117-verify-post-migration\.sql/)
  })

  it('the rollback is ONE statement, so a client that runs statements separately cannot skip the guard', () => {
    // An earlier version was BEGIN; DO guard; DROP ...; COMMIT;. A client that sent those one at a time and ignored
    // errors skipped the guard (it lived on another connection) and still ran the drops. Keep guard and drops atomic.
    const code = ROLLBACK.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .replace(/\$\$[\s\S]*?\$\$/g, () => '<body>').replace(/'(?:[^']|'')*'/g, "''")
    expect(code.trim()).toBe('DO <body>;')
    expect(ROLLBACK).not.toMatch(/^\s*(BEGIN|COMMIT);/m)
    // and the guard is inside that statement, before any DROP
    expect(ROLLBACK.indexOf('I-ACCEPT-PRODUCTION-BREAKAGE')).toBeLessThan(ROLLBACK.indexOf('DROP TABLE IF EXISTS public.article_engagement_sessions'))
  })

  // ── the post-migration verification script (the one to run against production) ───────────────────
  const runVerify = async (client: Client) => {
    await client.query('BEGIN READ ONLY') // proves the script writes nothing: any write would throw
    try {
      const res = (await client.query(VERIFY)) as unknown as { rows: { check_name: string; result: string; detail: string }[] }
      return res.rows
    } finally {
      await client.query('ROLLBACK')
    }
  }

  it('verify script: is one read-only SELECT with no write, DDL or privilege statements', () => {
    // Scan only executable SQL: drop comment lines, the $q$...$q$ block (a SELECT, checked by running it read-only
    // below) and string literals (one legitimately contains the words CREATE UNIQUE INDEX).
    const code = VERIFY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .replace(/\$q\$[\s\S]*?\$q\$/g, '').replace(/'(?:[^']|'')*'/g, "''")
    expect(code).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum|reindex|set_config|nextval)\b/i)
    expect(code.match(/;/g)).toHaveLength(1) // a single statement
    expect(code.trim().endsWith(';')).toBe(true)
  })

  it('verify script: a fully remediated database (migrations + article_comments, API roles closed) reports no FAIL and no row contents', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(read('supabase/migrations/add_article_comments.sql'))
      // Production's table owner has no default grants to anon/authenticated; make this database match.
      await client.query('REVOKE ALL ON article_image_assets, article_engagement_sessions, article_comments FROM anon, authenticated')
      await client.query(`insert into subscribers (id, email) values ('s9', 'private.person@example.test'); insert into tags (id, name, slug) values ('t9', 'Private Topic', 'private-topic')`)
      const rows = await runVerify(client)
      expect(rows.filter((r) => r.result === 'FAIL')).toEqual([])
      expect(rows.filter((r) => r.result === 'ok').length).toBeGreaterThanOrEqual(25)
      expect(rows.find((r) => r.check_name === 'rows in article_image_assets')).toMatchObject({ result: 'info', detail: '0' })
      expect(JSON.stringify(rows)).not.toMatch(/example\.test|Private Topic|private-topic/) // counts and names only
    }, { supabaseRoles: true })
  })

  it('verify script: detects each way the lock-down could regress (API-role grants, RLS off, wrong FK rule, extra policy, missing object)', async () => {
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      await client.query(read('supabase/migrations/add_article_comments.sql'))
      // As Supabase defaults would leave a table created by supabase_admin: anon and authenticated granted everything.
      const failing = async () => (await runVerify(client)).filter((r) => r.result === 'FAIL').map((r) => r.check_name)
      expect(await failing()).toEqual(['no API-role privileges on article_engagement_sessions', 'no API-role privileges on article_image_assets'])

      await client.query('REVOKE ALL ON article_image_assets, article_engagement_sessions FROM anon, authenticated')
      expect(await failing()).toEqual([])

      await client.query('GRANT SELECT ("uploaderId") ON article_image_assets TO anon') // a column-level grant must be caught too
      expect(await failing()).toEqual(['no API-role privileges on article_image_assets'])
      await client.query('REVOKE ALL ("uploaderId") ON article_image_assets FROM anon')

      await client.query('ALTER TABLE article_image_assets DISABLE ROW LEVEL SECURITY')
      expect(await failing()).toEqual(['rls article_image_assets'])
      await client.query('ALTER TABLE article_image_assets ENABLE ROW LEVEL SECURITY')

      await client.query(`create policy open_read on article_engagement_sessions for select using (true)`)
      expect(await failing()).toEqual(['no policies on article_engagement_sessions'])
      await client.query('drop policy open_read on article_engagement_sessions')

      await client.query(`alter table article_tags drop constraint "article_tags_tagId_fkey", add constraint "article_tags_tagId_fkey" foreign key ("tagId") references tags(id) on delete cascade`)
      expect(await failing()).toEqual(['fk article_tags_tagId_fkey is RESTRICT'])
      await client.query(`alter table article_tags drop constraint "article_tags_tagId_fkey", add constraint "article_tags_tagId_fkey" foreign key ("tagId") references tags(id) on delete restrict on update cascade`)

      await client.query('drop index subscribers_normalized_email_key')
      expect(await failing()).toEqual(['index subscribers_normalized_email_key'])
    }, { supabaseRoles: true })
  })

  it('verify script: on the pre-#117 database it REPORTS the missing objects as FAIL rather than erroring', async () => {
    await withDatabase(async ({ client }) => {
      const rows = await runVerify(client)
      const failed = rows.filter((r) => r.result === 'FAIL').map((r) => r.check_name)
      expect(failed).toEqual(expect.arrayContaining([
        'function consilium_tag_identity', 'function consilium_subscriber_identity', 'function results',
        'table article_image_assets', 'table article_engagement_sessions', 'fk article_tags_tagId_fkey is RESTRICT',
        'table article_comments (separate migration)',
      ]))
      expect(rows.find((r) => r.check_name === 'rows in article_image_assets')).toMatchObject({ detail: 'table missing' })
    })
  })

  // ── the separate, older gap: article_comments (inline editorial comments, #97) ────────────────────
  it('article_comments (a pre-existing, separate gap): applies, replays, matches the Prisma model, works through the real client, and rolls back', async () => {
    await withDatabase(async ({ client, url }) => {
      await applyAll(client)
      const addTable = read('supabase/migrations/add_article_comments.sql')
      const addColumn = read('supabase/migrations/add_article_comments_quoted_text.sql')
      await client.query(addTable)
      await client.query(addTable) // replay: "IF NOT EXISTS" throughout, including the policy
      await client.query(addColumn) // a documented no-op once the table has the column
      expect((await client.query(`select count(*)::int as n from pg_policies where tablename = 'article_comments'`)).rows[0].n).toBe(1)

      // Now nothing the deployed Prisma schema expects is missing except what the declared later migrations add.
      expect(await missingPrismaColumns(client)).toEqual(LATER_COLUMNS)

      const { db } = await loadApp(url)
      try {
        const root = await db.articleComment.create({ data: { articleId: 'a1', authorId: 'author', commentText: 'Tighten this', tiptapFrom: 3, tiptapTo: 9, quotedText: 'the thing' } })
        const reply = await db.articleComment.create({ data: { articleId: 'a1', authorId: 'author', commentText: 'Done', parentId: root.id } })
        expect((await db.articleComment.findMany({ where: { articleId: 'a1' } })).length).toBe(2)
        // deleting an article, and a parent comment, cascade
        await db.articleComment.delete({ where: { id: root.id } })
        expect(await db.articleComment.count({ where: { id: reply.id } })).toBe(0)
      } finally {
        await db.$disconnect()
      }

      // rollback of this one is simply dropping the (new) table; it is empty here
      await client.query('DROP TABLE article_comments')
      expect((await client.query(`select to_regclass('public.article_comments') as t`)).rows[0].t).toBeNull()
    }, { supabaseRoles: true })
  })

  it('SQL and JavaScript agree on tag identity for a wide set of labels (the contract the unique index enforces)', async () => {
    // Case mapping comes from the server's C library. macOS disagrees with Linux on this Greek label
    // (a laptop artifact: the production Linux server agrees with the JavaScript, see
    // tests/unit/tag-identity-production-parity.test.ts), so it is only asserted where the platform is Linux.
    const platformSensitive = process.platform === 'linux' ? [] : ['ὈΔΥΣΣΕΎΣ']
    await withDatabase(async ({ client }) => {
      await applyAll(client)
      const labels = [
        'Finance', ' Investment & Finance ', 'INVESTMENT---FINANCE', 'Ｆｉｎａｎｃｅ', 'Économie', 'İnflation', 'ΟΣ', 'ὈΔΥΣΣΕΎΣ',
        '中文', 'Trade/Policy', 'a_b-c d', 'ﬁnance', 'Straße', 'NAÏVE café', '  --x--  ', 'AI & ML (2026)', 'Q3 results', '日本語 market',
        'économie', 'Ǆ', 'ǅ', 'KELVIN', 'ⅷ', '①②③', 'MiXeD CaSe',
      ]
      const mismatches: string[] = []
      for (const label of labels.filter((l) => !platformSensitive.includes(l))) {
        const sql = (await client.query('select public.consilium_tag_identity($1) as slug', [label])).rows[0].slug
        if (sql !== canonicalTagSlug(label)) mismatches.push(`${JSON.stringify(label)}: sql=${JSON.stringify(sql)} js=${JSON.stringify(canonicalTagSlug(label))}`)
      }
      expect(mismatches, mismatches.join('\n')).toEqual([])
    })
  })
})
