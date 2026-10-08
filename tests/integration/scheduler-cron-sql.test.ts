/**
 * Executes the Supabase Cron migrations' own PL/pgSQL against a real Postgres.
 *
 * pg_cron, pg_net and Vault are Supabase-managed and not installable locally, so minimal
 * stand-ins for the `vault`, `net` and `cron` schemas are created here. They let the
 * migrations' SQL, logic and permissions run for real; they do NOT prove the behaviour of
 * the real extensions (the controlled invocation in docs/scheduler-supabase-cron.md does).
 *
 * Destructive to the schemas it creates, so it refuses to run anywhere except a database
 * whose name contains "cron_stub" on a host the central guard accepts:
 *
 *   createdb -h localhost -p 5433 -U postgres -T template0 consilium_cron_stub
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5433/consilium_cron_stub \
 *     npx vitest run tests/integration/scheduler-cron-sql.test.ts
 *   dropdb -h localhost -p 5433 -U postgres consilium_cron_stub
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
const DB_NAME = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, '') : ''
const enabled = Boolean(TEST_DB) && DB_NAME.includes('cron_stub')
if (enabled) assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
else console.warn('[scheduler-cron-sql] skipped: needs TEST_DATABASE_URL pointing at a *cron_stub* database')
const suite = enabled ? describe : describe.skip

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const INFRA = readFileSync(join(MIGRATIONS, '20261007120000_scheduler_cron_infrastructure.sql'), 'utf8')
const ENABLE = readFileSync(join(MIGRATIONS, '20261007120100_scheduler_cron_enable_publish.sql'), 'utf8')
// Only the two CREATE EXTENSION lines are removed: the stand-ins replace the extensions.
const withoutExtensions = (sql: string) =>
  sql.split('\n').filter((l) => !l.startsWith('CREATE EXTENSION IF NOT EXISTS')).join('\n')

const SECRET = 'dummy-secret-0123456789-abcdefghij-not-real'
const API_ROLES = ['anon', 'authenticated', 'service_role']

const STAND_INS = `
create schema vault;
create table vault.secrets (id bigserial primary key, name text unique, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;

create schema net;
create sequence net.req_seq;
create function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds int default 5000
) returns bigint language sql as $$ select nextval('net.req_seq') $$;
create table net._http_response (
  id bigint, status_code int, content_type text, headers jsonb, content text,
  timed_out bool, error_msg text, created timestamptz default now()
);

create schema cron;
-- the real pg_cron enforces one job per (jobname, username); scheduling a name again replaces it
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.unschedule(j bigint) returns boolean language sql as $$ delete from cron.job where jobid = j returning true $$;
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
`

let db: Client
const createdRoles: string[] = []
const q = (sql: string) => db.query(sql)
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await q(sql)).rows[0] as T

/** Queues a request through the real invoke function and lets the stand-in "pg_net" answer it. */
async function invokeAndRespond(response: { status?: number | null; timedOut?: boolean; errorMsg?: string; body?: string } | null) {
  const { rid } = await one<{ rid: string | null }>('select public.invoke_publish_scheduled() as rid')
  if (rid === null) return { rid: null }
  if (response) {
    await db.query(
      'insert into net._http_response (id, status_code, content, timed_out, error_msg) values ($1, $2, $3, $4, $5)',
      [rid, response.status ?? null, response.body ?? null, response.timedOut ?? false, response.errorMsg ?? null],
    )
    await q('select public.reconcile_scheduler_invocations()')
  }
  return { rid }
}
const row = (rid: string) =>
  one<{ outcome: string; status_code: number | null; error: string | null; completed_at: Date | null }>(
    `select outcome, status_code, error, completed_at from public.scheduler_invocations where request_id = ${rid}`,
  )

suite('Supabase Cron migrations (stand-in vault/net/cron, real PL/pgSQL)', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: TEST_DB })
    await db.connect()
    await q(`drop schema if exists vault, net, cron cascade;
             drop table if exists public.scheduler_invocations cascade;
             drop function if exists public.invoke_publish_scheduled();
             drop function if exists public.reconcile_scheduler_invocations();`)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const exists = (await q(`select 1 from pg_roles where rolname = '${role}'`)).rowCount
      if (!exists) {
        await q(`create role ${role} nologin`)
        createdRoles.push(role)
      }
    }
    await q(STAND_INS)
  })

  afterAll(async () => {
    try {
      await q('reset role')
      await q(`drop schema if exists vault, net, cron cascade;
               drop table if exists public.scheduler_invocations cascade;
               drop function if exists public.invoke_publish_scheduled();
               drop function if exists public.reconcile_scheduler_invocations();`)
      for (const role of createdRoles) await q(`drop role if exists ${role}`)
    } finally {
      await db.end()
    }
  })

  // ── 3. the enable migration cannot succeed without the infrastructure migration ──────────────
  describe('ordering is enforced by the database, not by convention', () => {
    it('the enable migration is refused on a database without the infrastructure migration', async () => {
      await expect(q(ENABLE)).rejects.toThrow(/infrastructure/i)
      expect((await one<{ n: string }>(`select count(*) n from cron.job where jobname = 'publish-scheduled'`)).n).toBe('0')
    })

    it('the infrastructure migration applies, and applies again (idempotent)', async () => {
      await q(withoutExtensions(INFRA))
      await q(withoutExtensions(INFRA))
      const jobs = (await q('select jobname from cron.job order by jobname')).rows.map((r) => r.jobname)
      // reconciler + history pruning; the publisher is NOT scheduled by it
      expect(jobs).toEqual(['prune-cron-run-details', 'reconcile-scheduler-invocations'])
    })

    it('the enable migration is refused while the Vault secret does not exist', async () => {
      await expect(q(ENABLE)).rejects.toThrow(/publish_cron_secret/)
    })

    it('the enable migration is refused until a controlled invocation has been recorded as a success', async () => {
      await q(`insert into vault.secrets (name, secret) values ('publish_cron_secret', '${SECRET}')`)
      await expect(q(ENABLE)).rejects.toThrow(/controlled invocation|success/i)
      expect((await one<{ n: string }>(`select count(*) n from cron.job where jobname = 'publish-scheduled'`)).n).toBe('0')
    })

    it('after a recorded 200 the enable migration schedules exactly one */5 job, however often it is applied', async () => {
      const { rid } = await invokeAndRespond({ status: 200, body: '{"due":0,"published":0}' })
      expect((await row(rid!)).outcome).toBe('success')
      await q(ENABLE)
      await q(ENABLE)
      const jobs = (await q(`select jobname, schedule, command from cron.job where jobname = 'publish-scheduled'`)).rows
      expect(jobs).toEqual([
        { jobname: 'publish-scheduled', schedule: '*/5 * * * *', command: 'select public.invoke_publish_scheduled()' },
      ])
    })
  })

  // ── 4. outcomes are classified, not just stored ─────────────────────────────────────────────
  describe('response reconciliation distinguishes every outcome', () => {
    it('a request is pending until its response is reconciled', async () => {
      const { rid } = await invokeAndRespond(null)
      expect(await row(rid!)).toMatchObject({ outcome: 'pending', status_code: null, completed_at: null })
    })

    it.each([
      ['200 with the endpoint JSON is success', { status: 200, body: '{"due":0,"published":0,"warnings":[]}' }, 'success', 200],
      ['200 without the endpoint JSON is bad_response', { status: 200, body: '{"published":0}' }, 'bad_response', 200],
      ['a bodyless 2xx cannot have come from the endpoint', { status: 204 }, 'bad_response', 204],
      ['401 authentication failure', { status: 401, body: '{"error":"Unauthorized"}' }, 'auth_failure', 401],
      ['403 authentication failure', { status: 403 }, 'auth_failure', 403],
      ['307 (wrong host) is a non-2xx', { status: 307 }, 'http_error', 307],
      ['500 is a non-2xx', { status: 500, body: '{"error":"x"}' }, 'http_error', 500],
      ['timeout', { status: null, timedOut: true, errorMsg: 'Timeout of 30000 ms reached' }, 'timeout', null],
      ['connection failure without a status', { status: null, errorMsg: "Couldn't connect to server" }, 'network_error', null],
    ] as const)('%s', async (_label, response, outcome, status) => {
      const { rid } = await invokeAndRespond(response)
      const r = await row(rid!)
      expect(r.outcome).toBe(outcome)
      expect(r.status_code).toBe(status)
      expect(r.completed_at).not.toBeNull()
    })

    it('a request with no response after 10 minutes is flagged lost, distinct from a timeout', async () => {
      const { rid } = await invokeAndRespond(null)
      await q(`update public.scheduler_invocations set invoked_at = now() - interval '11 minutes' where request_id = ${rid}`)
      await q('select public.reconcile_scheduler_invocations()')
      expect(await row(rid!)).toMatchObject({ outcome: 'lost', error: 'no response recorded by pg_net' })
    })

    it('a request younger than 10 minutes with no response is NOT yet called lost', async () => {
      const { rid } = await invokeAndRespond(null)
      await q('select public.reconcile_scheduler_invocations()')
      expect((await row(rid!)).outcome).toBe('pending')
    })

    it('a missing Vault secret records not_sent and sends nothing', async () => {
      await q(`update vault.secrets set secret = '' where name = 'publish_cron_secret'`)
      const before = (await one<{ n: string }>('select last_value::text n from net.req_seq')).n
      const { rid } = await invokeAndRespond(null)
      expect(rid).toBeNull()
      expect((await one<{ n: string }>('select last_value::text n from net.req_seq')).n).toBe(before)
      expect(
        await one(`select outcome, request_id from public.scheduler_invocations where outcome = 'not_sent' order by id desc limit 1`),
      ).toMatchObject({ outcome: 'not_sent', request_id: null })
      await q(`update vault.secrets set secret = '${SECRET}' where name = 'publish_cron_secret'`)
    })

    it('outcome can only ever be one of the known categories', async () => {
      await expect(q(`insert into public.scheduler_invocations (job, outcome) values ('x', 'bogus')`)).rejects.toThrow(/check/i)
    })
  })

  // ── 1. retention is enforced by the design ──────────────────────────────────────────────────
  describe('bounded retention', () => {
    const old = `now() - interval '31 days'`
    it('the reconciler prunes rows older than 30 days', async () => {
      await q(`insert into public.scheduler_invocations (job, request_id, invoked_at, completed_at, outcome) values ('publish-scheduled', 770001, ${old}, ${old}, 'success')`)
      await q('select public.reconcile_scheduler_invocations()')
      expect((await one<{ n: string }>('select count(*) n from public.scheduler_invocations where request_id = 770001')).n).toBe('0')
    })

    it('the publisher function prunes too, so retention holds even if the reconciler job stops', async () => {
      await q(`insert into public.scheduler_invocations (job, request_id, invoked_at, completed_at, outcome) values ('publish-scheduled', 770002, ${old}, ${old}, 'success')`)
      await q('select public.invoke_publish_scheduled()')
      expect((await one<{ n: string }>('select count(*) n from public.scheduler_invocations where request_id = 770002')).n).toBe('0')
    })

    it('recent rows are kept', async () => {
      const { rid } = await invokeAndRespond({ status: 200, body: '{"due":0,"published":0,"warnings":[]}' })
      await q('select public.reconcile_scheduler_invocations()')
      expect((await row(rid!)).outcome).toBe('success')
    })
  })

  // ── 5. the secret never leaves Vault ────────────────────────────────────────────────────────
  describe('the secret is never stored or logged', () => {
    it('is absent from the migration source, every cron command, both function bodies and the log table', async () => {
      expect(INFRA).not.toContain(SECRET)
      expect(ENABLE).not.toContain(SECRET)
      expect((await one<{ n: string }>(`select count(*) n from cron.job where command like '%${SECRET}%'`)).n).toBe('0')
      expect(
        (await one<{ n: string }>(`select count(*) n from pg_proc where prosrc like '%${SECRET}%'`)).n,
      ).toBe('0')
      expect(
        (await one<{ n: string }>(
          `select count(*) n from public.scheduler_invocations where coalesce(response_body,'') like '%${SECRET}%' or coalesce(error,'') like '%${SECRET}%'`,
        )).n,
      ).toBe('0')
    })
  })

  // ── 6. API roles can neither invoke nor read ────────────────────────────────────────────────
  describe('anon, authenticated and service_role are locked out', () => {
    const fns = ['public.invoke_publish_scheduled()', 'public.reconcile_scheduler_invocations()']

    it.each(API_ROLES)('%s holds no privilege on either function or on the log table', async (role) => {
      for (const fn of fns) {
        expect((await one<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).ok).toBe(false)
      }
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await one<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.scheduler_invocations', '${priv}') ok`)).ok).toBe(false)
      }
    })

    it('PUBLIC holds no privilege either (no implicit EXECUTE left on the SECURITY DEFINER functions)', async () => {
      const grants = await q(`
        select p.proname from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.proname in ('invoke_publish_scheduled', 'reconcile_scheduler_invocations') and a.grantee = 0`)
      expect(grants.rowCount).toBe(0)
      const table = await q(`
        select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where c.oid = 'public.scheduler_invocations'::regclass and a.grantee = 0`)
      expect(table.rowCount).toBe(0)
    })

    it.each(['anon', 'authenticated'])('%s is refused when it actually tries', async (role) => {
      await q(`set role ${role}`)
      try {
        await expect(q('select public.invoke_publish_scheduled()')).rejects.toThrow(/permission denied/)
        await expect(q('select public.reconcile_scheduler_invocations()')).rejects.toThrow(/permission denied/)
        await expect(q('select * from public.scheduler_invocations')).rejects.toThrow(/permission denied/)
      } finally {
        await q('reset role')
      }
    })

    it('row level security is on for the log table', async () => {
      expect((await one<{ rls: boolean }>(`select relrowsecurity rls from pg_class where oid = 'public.scheduler_invocations'::regclass`)).rls).toBe(true)
    })
  })
})
