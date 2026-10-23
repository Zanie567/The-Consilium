/**
 * Migration 20261023120000 on a database shaped like production before this work (Prisma DDL of
 * origin/main plus the earlier identity migration), with historical subscribers and Supabase-style API
 * grants. Proves: additive, idempotent, no re-consent of historical rows, old code keeps working, RLS/grants
 * locked down, identical shape to a `prisma db push` database, and the rollback restores the old shape
 * without losing a subscriber. Throwaway databases only.
 */
import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { emailHash } from '@/lib/newsletter/identity'

const base = process.env.TEST_DATABASE_URL!
assertSafeTestDatabaseHost(base, 'TEST_DATABASE_URL')
const read = (path: string) => readFileSync(path, 'utf8')
const BEFORE = read('tests/fixtures/schema-before-newsletter.sql')
const IDENTITY = read('supabase/migrations/20261006161413_normalized_subscriber_email.sql')
const MIGRATION = read('supabase/migrations/20261023120000_newsletter_subscriptions.sql')
const ROLLBACK = read('supabase/manual/20261023120000_newsletter_subscriptions_rollback.sql')
const TABLES = ['subscribers', 'subscriber_tokens', 'subscriber_consent_events', 'newsletter_suppressions', 'newsletter_campaigns', 'newsletter_webhook_events']

async function withDatabase(run: (client: Client) => Promise<void>) {
  const admin = new Client({ connectionString: base })
  await admin.connect()
  const name = `consilium_nl_migration_${randomUUID().replaceAll('-', '')}`
  const url = new URL(base)
  url.pathname = `/${name}`
  let client: Client | undefined
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    for (const role of ['anon', 'authenticated']) await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    client = new Client({ connectionString: url.href })
    await client.connect()
    await run(client)
  } finally {
    await client?.end()
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  }
}

async function columns(client: Client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '') AS d
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1, 2`,
    [TABLES],
  )
  return rows.map((r) => `${r.table_name}.${r.column_name} ${r.udt_name} ${r.is_nullable} ${r.d}`)
}

async function productionShaped(client: Client) {
  await client.query(BEFORE)
  await client.query(IDENTITY)
  // Supabase's historical default: API roles granted on tables (20260408000100 later revoked them).
  await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`)
  await client.query(`INSERT INTO subscribers (id, email, "subscribedAt") VALUES
    ('s1', 'reader.one@example.test', '2026-05-01'), ('s2', ' Reader.Two@Example.Test ', '2026-06-01'), ('s3', 'three@example.test', '2026-09-01')`)
}

describe('newsletter migration on a production-shaped database', () => {
  it('classifies historical subscribers as LEGACY without inventing consent, and is idempotent', async () => {
    await withDatabase(async (client) => {
      await productionShaped(client)
      await client.query(MIGRATION)
      const { rows } = await client.query(`SELECT id, status, "weeklyDigest", "specialAlerts", "confirmedAt", "consentSource", "resendSyncState" FROM subscribers ORDER BY id`)
      expect(rows).toEqual(['s1', 's2', 's3'].map((id) => ({ id, status: 'LEGACY', weeklyDigest: true, specialAlerts: false, confirmedAt: null, consentSource: 'legacy_signup_form', resendSyncState: 'SYNCED' })))
      const events = await client.query(`SELECT "subscriberId", "emailHash", action FROM subscriber_consent_events ORDER BY "subscriberId"`)
      expect(events.rows).toEqual([
        { subscriberId: 's1', emailHash: emailHash('reader.one@example.test'), action: 'LEGACY_IMPORTED' },
        { subscriberId: 's2', emailHash: emailHash('reader.two@example.test'), action: 'LEGACY_IMPORTED' },
        { subscriberId: 's3', emailHash: emailHash('three@example.test'), action: 'LEGACY_IMPORTED' },
      ])

      // The currently deployed code inserts only an email: the row is PENDING (never mailed).
      await client.query(`INSERT INTO subscribers (id, email) VALUES ('s4', 'new@example.test')`)
      // Replaying the migration changes nothing, and never turns a later row into LEGACY.
      await client.query(MIGRATION)
      expect((await client.query(`SELECT status FROM subscribers WHERE id = 's4'`)).rows[0].status).toBe('PENDING')
      expect((await client.query(`SELECT count(*)::int AS n FROM subscriber_consent_events`)).rows[0].n).toBe(3)
      // The old unsubscribe (DELETE) still works and the consent record survives with the hash.
      await client.query(`DELETE FROM subscribers WHERE id = 's3'`)
      expect((await client.query(`SELECT "subscriberId" FROM subscriber_consent_events WHERE "emailHash" = $1`, [emailHash('three@example.test')])).rows).toEqual([{ subscriberId: null }])
    })
  })

  it('locks every newsletter table to the owner: RLS on, nothing for anon/authenticated', async () => {
    await withDatabase(async (client) => {
      await productionShaped(client)
      await client.query(MIGRATION)
      const { rows } = await client.query(
        `SELECT c.relname, c.relrowsecurity,
                has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
                has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authed
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1) ORDER BY 1`,
        [TABLES],
      )
      expect(rows).toHaveLength(TABLES.length)
      for (const row of rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, anon: false, authed: false })
      const fn = await client.query(`SELECT has_function_privilege('anon', 'protect_newsletter_campaign()', 'EXECUTE') AS anon`)
      expect(fn.rows[0].anon).toBe(false)
    })
  })

  it('produces exactly the columns a `prisma db push` of the new schema produces', async () => {
    const pushed = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], { encoding: 'utf8', env: { ...process.env } })
    let migrated: string[] = []
    let expected: string[] = []
    await withDatabase(async (client) => {
      await productionShaped(client)
      await client.query(MIGRATION)
      migrated = await columns(client)
    })
    await withDatabase(async (client) => {
      await client.query(pushed)
      expected = await columns(client)
    })
    expect(migrated).toEqual(expected)
  })

  it('rolls back to the previous shape without losing a subscriber, and refuses once anything was sent', async () => {
    await withDatabase(async (client) => {
      await productionShaped(client)
      const before = await columns(client)
      await client.query(MIGRATION)
      await client.query(`UPDATE subscribers SET status = 'ACTIVE', "confirmedAt" = now() WHERE id = 's1'`)
      await client.query(ROLLBACK)
      expect(await columns(client)).toEqual(before)
      expect((await client.query(`SELECT id, email FROM subscribers ORDER BY id`)).rows.map((r) => r.id)).toEqual(['s1', 's2', 's3'])
      // Re-applying after a rollback works.
      await client.query(MIGRATION)
      await client.query(`INSERT INTO newsletter_campaigns (id, kind, "editionKey", status, subject, articles, "contentHash", "approvedHash", "approvedAt", "scheduledFor", "sentAt", "resendBroadcastId", "updatedAt")
        VALUES ('c1', 'WEEKLY', 'weekly:2026-10-30', 'SENT', 's', '{}', 'h', 'h', now(), now(), now(), 'b1', now())`)
      await expect(client.query(ROLLBACK)).rejects.toThrow(/refusing to roll back/)
    })
  })
})

/**
 * Splits the migration into top-level statements: respects -- comments, '...' strings and $$ bodies.
 * (Enough for this file, which uses no other quoting.)
 */
function statements(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let inDollar = false
  let inString = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    if (!inDollar && !inString && two === '--') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      current += '\n'
      continue
    }
    if (!inString && two === '$$') {
      inDollar = !inDollar
      current += two
      i++
      continue
    }
    if (!inDollar && ch === "'") inString = !inString
    current += ch
    if (ch === ';' && !inDollar && !inString) {
      if (current.trim() !== ';') out.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

async function finalState(client: Client) {
  const rows = await client.query(`SELECT id, status, "specialAlerts", "confirmedAt" IS NULL AS unconfirmed FROM subscribers ORDER BY id`)
  const events = await client.query(`SELECT "subscriberId" FROM subscriber_consent_events WHERE action = 'LEGACY_IMPORTED' ORDER BY 1`)
  const rls = await client.query(`SELECT bool_and(relrowsecurity) AS on FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`, [TABLES])
  const trigger = await client.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'newsletter_campaigns_protect'`)
  return { columns: await columns(client), rows: rows.rows, events: events.rows.map((r) => r.subscriberId), rls: rls.rows[0].on, trigger: trigger.rows[0].n }
}

const psqlAvailable = spawnSync('psql', ['--version']).status === 0
function runApply(databaseUrl: string, resume: boolean) {
  return spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(resume ? ['-v', 'resume=1'] : []), '-f', 'docs/newsletter/production/apply.sql', databaseUrl], { encoding: 'utf8' })
}

describe('interrupted migration attempts', () => {
  const parts = statements(MIGRATION)

  it('the splitter sees every statement of the file', () => {
    expect(parts.length).toBeGreaterThan(20)
    expect(parts.join('\n')).toContain('protect_newsletter_campaign')
    expect(parts.filter((p) => p.startsWith('DO $$')).length).toBeGreaterThanOrEqual(4)
  })

  it('stopped after ANY statement (no transaction), a re-run reaches exactly the clean end state', async () => {
    let clean: Awaited<ReturnType<typeof finalState>> | undefined
    await withDatabase(async (client) => {
      await productionShaped(client)
      await client.query(MIGRATION)
      clean = await finalState(client)
    })
    for (let k = 1; k < parts.length; k++) {
      await withDatabase(async (client) => {
        await productionShaped(client)
        for (const statement of parts.slice(0, k)) await client.query(statement) // autocommit, then "crash"
        await client.query(MIGRATION) // operator re-runs the whole file
        await client.query(MIGRATION) // and again: still nothing changes
        expect(await finalState(client), `interrupted after statement ${k}: ${parts[k - 1].slice(0, 80)}`).toEqual(clean)
      })
    }
  }, 300_000)

  it('a sign-up made by the old code between a partial run and the re-run is never classified LEGACY', async () => {
    await withDatabase(async (client) => {
      await productionShaped(client)
      // Interrupted right after the status column (and classification) statement.
      const k = parts.findIndex((p) => p.includes('first_run boolean')) + 1
      for (const statement of parts.slice(0, k)) await client.query(statement)
      await client.query(`INSERT INTO subscribers (id, email) VALUES ('between', 'between@example.test')`)
      await client.query(MIGRATION)
      const { rows } = await client.query(`SELECT id, status FROM subscribers ORDER BY id`)
      expect(rows).toEqual([{ id: 'between', status: 'PENDING' }, { id: 's1', status: 'LEGACY' }, { id: 's2', status: 'LEGACY' }, { id: 's3', status: 'LEGACY' }])
    })
  })

  it('killed mid-transaction, nothing is left behind', async () => {
    await withDatabase(async (client) => {
      await productionShaped(client)
      const before = await columns(client)
      await client.query('BEGIN')
      for (const statement of parts.slice(0, Math.floor(parts.length / 2))) await client.query(statement)
      await client.query('ROLLBACK') // what PostgreSQL does when the session dies
      expect(await columns(client)).toEqual(before)
      expect((await client.query(`SELECT to_regclass('public.newsletter_campaigns') AS t`)).rows[0].t).toBeNull()
    })
  })

  it.skipIf(!psqlAvailable)('apply.sql: guarded first apply; refuses a partial schema unless resume=1, which then verifies the end state', async () => {
    await withDatabase(async (client) => {
      await productionShaped(client)
      await client.query(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[])`)
      const url = new URL(base)
      url.pathname = `/${client.database}`
      // A partial, non-transactional run stopped half-way.
      for (const statement of parts.slice(0, Math.floor(parts.length / 2))) await client.query(statement)
      const refused = runApply(url.href, false)
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toMatch(/re-run with -v resume=1/)
      const resumed = runApply(url.href, true)
      expect(resumed.stderr).toMatch(/newsletter migration verified \(resume\): 3 subscriber\(s\) LEGACY/)
      expect(resumed.status).toBe(0)
      expect((await client.query(`SELECT count(*)::int AS n FROM subscriber_consent_events WHERE action = 'LEGACY_IMPORTED'`)).rows[0].n).toBe(3)
    })
    await withDatabase(async (client) => {
      await productionShaped(client)
      await client.query(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[])`)
      const url = new URL(base)
      url.pathname = `/${client.database}`
      const first = runApply(url.href, false)
      expect(first.stderr).toMatch(/newsletter migration verified \(first\): 3 subscriber\(s\) LEGACY/)
      expect(first.status).toBe(0)
    })
  })
})
