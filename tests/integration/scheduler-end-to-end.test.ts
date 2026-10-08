/**
 * Scheduler end to end, as far as it can be exercised without Supabase itself:
 *
 *   migration SQL (real PL/pgSQL)  ->  the exact request it would send (captured)
 *     ->  the REAL /api/publish-scheduled route handler  ->  REAL Postgres rows
 *     ->  the response fed back through the migration's reconciler  ->  scheduler_invocations
 *
 * What is real: the migrations' SQL, the route handler, publishScheduledArticles(), Prisma,
 * the article/notification/achievement tables and their constraints, concurrency.
 * What is a stand-in: pg_cron, pg_net and Vault (Supabase-managed, not installable locally),
 * and the email transport and cache invalidation (a test must never send mail). The network
 * hop between pg_net and Vercel is replaced by a direct function call, so TLS, DNS, redirects
 * and the production host are NOT exercised here: the controlled invocation in
 * docs/scheduler-supabase-cron.md is the only proof of those.
 *
 * DESTRUCTIVE: it empties the article, notification and achievement tables and drops the
 * vault/net/cron schemas. It refuses to run anywhere except a database whose name contains
 * "sched_e2e" on a host the central guard accepts (never .env.local, never hosted Supabase):
 *
 *   createdb -h 127.0.0.1 -p 5433 -U postgres -T template0 consilium_sched_e2e
 *   TEST_HARNESS=1 DATABASE_URL=postgresql://postgres@127.0.0.1:5433/consilium_sched_e2e \
 *     DIRECT_URL=postgresql://postgres@127.0.0.1:5433/consilium_sched_e2e npx prisma db push
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/consilium_sched_e2e \
 *     npx vitest run tests/integration/scheduler-end-to-end.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL
const DB_NAME = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, '') : ''

async function ready(): Promise<boolean> {
  if (!TEST_DB || !DB_NAME.includes('sched_e2e')) return false
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(`select 1 from information_schema.tables where table_name = 'articles'`)
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const isReady = await ready()
if (!isReady) console.warn('[scheduler-end-to-end] skipped: needs TEST_DATABASE_URL pointing at a *sched_e2e* database with the Prisma schema pushed')
const suite = isReady ? describe : describe.skip

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const INFRA = readFileSync(join(MIGRATIONS, '20261007120000_scheduler_cron_infrastructure.sql'), 'utf8')
const withoutExtensions = (sql: string) =>
  sql.split('\n').filter((l) => !l.startsWith('CREATE EXTENSION IF NOT EXISTS')).join('\n')

const VAULT_SECRET = 'vault-secret-0123456789-abcdefghijklmnop-not-real'
const CANONICAL_URL = 'https://www.theconsilium.co.uk/api/publish-scheduled'

// Stand-ins. net.http_post RECORDS the request instead of sending it, so the test can replay
// precisely what the SQL produced. stub_mode='raise' makes it fail the way a broken pg_net would.
const STAND_INS = `
create schema vault;
create table vault.secrets (id bigserial primary key, name text unique, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;

create schema net;
create sequence net.req_seq;
create table net.calls (id bigint primary key, url text, body jsonb, headers jsonb, timeout_ms int);
create table net.stub_mode (mode text not null);
insert into net.stub_mode values ('ok');
create function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds int default 2000
) returns bigint language plpgsql as $$
declare v bigint;
begin
  if (select mode from net.stub_mode) = 'raise' then
    raise exception 'pg_net worker unavailable while queuing headers %', headers::text;
  end if;
  v := nextval('net.req_seq');
  insert into net.calls values (v, url, body, headers, timeout_milliseconds);
  return v;
end $$;
create table net._http_response (
  id bigint, status_code int, content_type text, headers jsonb, content text,
  timed_out bool, error_msg text, created timestamptz default now()
);

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table cron.job_run_details (
  runid bigserial primary key, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz
);
create function cron.unschedule(j bigint) returns boolean language sql as $$ delete from cron.job where jobid = j returning true $$;
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
`

let pg: Client
let db: PrismaClient
let POST: (req: Request) => Promise<Response>
let publishScheduledArticles: typeof import('@/lib/scheduledPublishing').publishScheduledArticles
const sendEmail = vi.fn<(m: { to: string; subject: string; html: string }) => Promise<boolean>>()
const revalidate = vi.fn()
let logged: string[] = []

const q = (sql: string, params?: unknown[]) => pg.query(sql, params)
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await q(sql)).rows[0] as T
const tag = `e2e${Date.now().toString(36)}`
let authorId = ''
let n = 0
const MIN = 60_000
const ago = (ms: number) => new Date(Date.now() - ms)

async function article(status: string, extra: Record<string, unknown> = {}) {
  n += 1
  return db.article.create({
    data: {
      title: `Article ${n}`,
      slug: `${tag}-${n}`,
      content: 'body',
      authorId,
      status: status as never,
      ...extra,
    },
  })
}
const state = async (id: string) =>
  db.article.findUniqueOrThrow({ where: { id }, select: { status: true, publishedAt: true, scheduledAt: true, deletedAt: true } })

type Transport = 'route' | 'timeout' | 'network' | { status: number; body: string }

/**
 * One scheduler tick: pg_cron runs invoke_publish_scheduled(), the request it queued is replayed
 * against the real route, the answer is stored where pg_net would store it, and the reconciler runs.
 */
async function tick(transport: Transport = 'route') {
  const { rid } = await one<{ rid: string | null }>('select public.invoke_publish_scheduled() as rid')
  if (rid === null) return { rid, call: null, status: null, body: null, row: await lastRow() }
  const call = await one<{ url: string; headers: Record<string, string>; body: unknown; timeout_ms: number }>(
    `select url, headers, body, timeout_ms from net.calls where id = ${rid}`,
  )
  let status: number | null = null
  let content: string | null = null
  let timedOut = false
  let errorMsg: string | null = null
  if (transport === 'route') {
    const res = await POST(
      new Request(call.url, { method: 'POST', headers: call.headers, body: JSON.stringify(call.body) }),
    )
    status = res.status
    content = await res.text()
  } else if (transport === 'timeout') {
    timedOut = true
    errorMsg = 'Timeout of 30000 ms reached'
  } else if (transport === 'network') {
    errorMsg = "Couldn't resolve host name"
  } else {
    status = transport.status
    content = transport.body
  }
  await q(
    'insert into net._http_response (id, status_code, content, timed_out, error_msg) values ($1, $2, $3, $4, $5)',
    [rid, status, content, timedOut, errorMsg],
  )
  await q('select public.reconcile_scheduler_invocations()')
  return { rid, call, status, body: content, row: await lastRow() }
}
const lastRow = () =>
  one<{
    outcome: string
    status_code: number | null
    error: string | null
    articles_due: number | null
    articles_published: number | null
    warning_count: number | null
  }>(
    `select outcome, status_code, error, articles_due, articles_published, warning_count
     from public.scheduler_invocations order by id desc limit 1`,
  )

suite('scheduler end to end (real migration SQL, real route, real database)', () => {
  beforeAll(async () => {
    assertSafeTestDatabaseHost(TEST_DB!, 'TEST_DATABASE_URL')
    pg = new Client({ connectionString: TEST_DB })
    await pg.connect()
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB! }) }) as unknown as PrismaClient

    vi.doMock('@/lib/prisma', () => ({ prisma: db }))
    vi.doMock('@/lib/email', () => ({
      sendEmail,
      articlePublishedEmail: (title: string, slug: string) => ({ subject: `Published: ${title}`, html: `<a href="/articles/${slug}">${title}</a>` }),
    }))
    vi.doMock('@/lib/revalidateArticles', () => ({ revalidateArticleLists: revalidate }))
    ;({ POST } = await import('@/app/api/publish-scheduled/route'))
    ;({ publishScheduledArticles } = await import('@/lib/scheduledPublishing'))

    for (const level of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }

    await q(`drop schema if exists vault, net, cron cascade;
             drop table if exists public.scheduler_invocations cascade;
             drop function if exists public.invoke_publish_scheduled();
             drop function if exists public.reconcile_scheduler_invocations();`)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (!(await q(`select 1 from pg_roles where rolname = '${role}'`)).rowCount) await q(`create role ${role} nologin`)
    }
    await q(STAND_INS)
    await q(withoutExtensions(INFRA))
    await q(`insert into vault.secrets (name, secret) values ('cron_secret', '${VAULT_SECRET}')`)

    const author = await db.user.create({ data: { email: `${tag}-author@example.test`, name: 'E2E Author', role: 'WRITER' } })
    authorId = author.id
  })

  beforeEach(async () => {
    process.env.CRON_SECRET = VAULT_SECRET
    logged = []
    sendEmail.mockReset().mockResolvedValue(true)
    revalidate.mockReset()
    await q(`update net.stub_mode set mode = 'ok'`)
    await q(`update vault.secrets set secret = '${VAULT_SECRET}' where name = 'cron_secret'`)
    await q('delete from public.scheduler_invocations')
    await db.writerAchievement.deleteMany({})
    await db.notification.deleteMany({})
    await db.article.deleteMany({})
  })

  afterAll(async () => {
    try {
      await db.writerAchievement.deleteMany({})
      await db.notification.deleteMany({})
      await db.article.deleteMany({})
      await db.user.deleteMany({ where: { id: authorId } })
      await db.$disconnect()
      await q(`drop schema if exists vault, net, cron cascade;
               drop table if exists public.scheduler_invocations cascade;
               drop function if exists public.invoke_publish_scheduled();
               drop function if exists public.reconcile_scheduler_invocations();`)
    } finally {
      await pg.end()
    }
  })

  // ── the SQL's request is what the route expects ───────────────────────────────────────────────
  describe('contract between the SQL and the endpoint', () => {
    it('sends a POST to the canonical www URL, with a Bearer header from Vault, inside a 30 s timeout', async () => {
      const { call, status, row } = await tick()
      expect(call!.url).toBe(CANONICAL_URL)
      expect(call!.headers.Authorization).toBe(`Bearer ${VAULT_SECRET}`)
      expect(call!.headers['Content-Type']).toBe('application/json')
      expect(call!.timeout_ms).toBe(30000)
      expect(status).toBe(200)
      expect(row).toMatchObject({ outcome: 'success', status_code: 200, articles_due: 0, articles_published: 0, warning_count: 0 })
    })

    it('a Vault secret that differs from CRON_SECRET is rejected: auth_failure, nothing published', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(5 * MIN) })
      await q(`update vault.secrets set secret = 'some-other-secret-value' where name = 'cron_secret'`)
      const { status, row } = await tick()
      expect(status).toBe(401)
      expect(row).toMatchObject({ outcome: 'auth_failure', status_code: 401 })
      expect((await state(a.id)).status).toBe('SCHEDULED')
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it('the route refuses a request with no credentials, a wrong one, or an empty Bearer', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(5 * MIN) })
      const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer ' }, { authorization: VAULT_SECRET }]
      for (const headers of attempts) {
        const res = await POST(new Request(CANONICAL_URL, { method: 'POST', headers }))
        expect(res.status).toBe(401)
      }
      expect((await state(a.id)).status).toBe('SCHEDULED')
    })

    it('a server without CRON_SECRET fails closed (500), never publishing', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(5 * MIN) })
      delete process.env.CRON_SECRET
      const { status, row } = await tick()
      expect(status).toBe(500)
      expect(row).toMatchObject({ outcome: 'http_error', status_code: 500 })
      expect((await state(a.id)).status).toBe('SCHEDULED')
    })
  })

  // ── what is and is not published ──────────────────────────────────────────────────────────────
  describe('which articles are published', () => {
    it('publishes a due article with every existing side effect, and reports it', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(2 * MIN) })
      const { row, body } = await tick()
      expect(JSON.parse(body!)).toMatchObject({ due: 1, published: 1, skipped: [], warnings: [] })
      expect(row).toMatchObject({ outcome: 'success', articles_due: 1, articles_published: 1, warning_count: 0 })

      const s = await state(a.id)
      expect(s.status).toBe('PUBLISHED')
      expect(s.scheduledAt).toBeNull()
      expect(s.publishedAt).not.toBeNull()
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(sendEmail.mock.calls[0][0].to).toBe(`${tag}-author@example.test`)
      expect(await db.notification.count({ where: { articleId: a.id, type: 'published' } })).toBe(1)
      expect(await db.writerAchievement.count({ where: { userId: authorId, type: 'first_publish' } })).toBe(1)
      expect(revalidate).toHaveBeenCalledTimes(1)
    })

    it('leaves a future article, drafts, trashed, and every other status alone', async () => {
      const future = await article('SCHEDULED', { scheduledAt: new Date(Date.now() + 60 * MIN) })
      const trashed = await article('SCHEDULED', { scheduledAt: ago(5 * MIN), deletedAt: ago(MIN) })
      const others = await Promise.all(
        (['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'ARCHIVED', 'PUBLISHED'] as const).map((st) =>
          // a stale scheduledAt on a non-SCHEDULED article must never make it eligible
          article(st, { scheduledAt: ago(5 * MIN), ...(st === 'PUBLISHED' ? { publishedAt: ago(60 * MIN) } : {}) }),
        ),
      )
      const before = await Promise.all([future, trashed, ...others].map((a) => state(a.id)))
      const { row } = await tick()
      expect(row).toMatchObject({ outcome: 'success', articles_due: 0, articles_published: 0 })
      expect(await Promise.all([future, trashed, ...others].map((a) => state(a.id)))).toEqual(before)
      expect(sendEmail).not.toHaveBeenCalled()
      expect(await db.notification.count()).toBe(0)
      expect(revalidate).not.toHaveBeenCalled()
    })

    it('treats scheduledAt as an exact UTC instant: due at the instant, not one millisecond before', async () => {
      const now = new Date('2026-10-25T01:30:00.000Z') // the hour the UK clocks go back
      const atNow = await article('SCHEDULED', { scheduledAt: now })
      const justAfter = await article('SCHEDULED', { scheduledAt: new Date(now.getTime() + 1) })
      const result = await publishScheduledArticles(now)
      expect(result.published.map((p) => p.id)).toEqual([atNow.id])
      expect((await state(justAfter.id)).status).toBe('SCHEDULED')
      expect((await state(atNow.id)).publishedAt?.toISOString()).toBe(now.toISOString())
    })
  })

  // ── repeated, concurrent and missed runs ──────────────────────────────────────────────────────
  describe('idempotence, concurrency and recovery', () => {
    it('running again and again publishes once, emails once, notifies once, awards once', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(MIN) })
      const first = await tick()
      const publishedAt = (await state(a.id)).publishedAt
      // The first publish legitimately creates two notifications: "Article published", and the
      // one-time "First article published" achievement. Repeated runs must add none.
      const notificationsAfterFirst = await db.notification.count({ where: { articleId: a.id } })
      expect(notificationsAfterFirst).toBe(2)
      const rest = [await tick(), await tick()]
      expect(first.row.articles_published).toBe(1)
      for (const r of rest) expect(r.row).toMatchObject({ outcome: 'success', articles_due: 0, articles_published: 0 })
      expect((await state(a.id)).publishedAt).toEqual(publishedAt)
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(await db.notification.count({ where: { articleId: a.id, type: 'published' } })).toBe(1)
      expect(await db.notification.count({ where: { articleId: a.id } })).toBe(notificationsAfterFirst)
      expect(await db.writerAchievement.count({ where: { userId: authorId, type: 'first_publish' } })).toBe(1)
    })

    it('eight overlapping runs over five due articles publish each exactly once with no duplicate side effects', async () => {
      const due = await Promise.all([1, 2, 3, 4, 5].map((i) => article('SCHEDULED', { scheduledAt: ago(i * MIN) })))
      const now = new Date()
      const results = await Promise.all(Array.from({ length: 8 }, () => publishScheduledArticles(now)))
      const publishedIds = results.flatMap((r) => r.published.map((p) => p.id))
      expect(publishedIds.sort()).toEqual(due.map((d) => d.id).sort())
      expect(new Set(publishedIds).size).toBe(5)
      expect(sendEmail).toHaveBeenCalledTimes(5)
      expect(await db.notification.count({ where: { type: 'published' } })).toBe(5)
      expect(await db.writerAchievement.count({ where: { type: 'first_publish' } })).toBeLessThanOrEqual(1) // one author: one first-publish
      for (const d of due) expect((await state(d.id)).status).toBe('PUBLISHED')
    })

    it('an article missed by several intervals is picked up by the next successful run', async () => {
      const missed = await article('SCHEDULED', { scheduledAt: ago(3 * 60 * MIN) })
      const recent = await article('SCHEDULED', { scheduledAt: ago(10 * MIN) })
      // three consecutive ticks fail in different ways: nothing is published, nothing is lost
      expect((await tick('timeout')).row.outcome).toBe('timeout')
      expect((await tick('network')).row.outcome).toBe('network_error')
      expect((await tick({ status: 503, body: 'upstream down' })).row.outcome).toBe('http_error')
      expect((await state(missed.id)).status).toBe('SCHEDULED')
      expect((await state(recent.id)).status).toBe('SCHEDULED')

      const { row } = await tick()
      expect(row).toMatchObject({ outcome: 'success', articles_due: 2, articles_published: 2 })
      expect((await state(missed.id)).status).toBe('PUBLISHED')
      expect((await state(recent.id)).status).toBe('PUBLISHED')
    })

    it('a database failure inside the endpoint is a recorded 500, loses nothing, and heals on the next run', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(MIN) })
      const spy = vi.spyOn(db.article, 'findMany').mockRejectedValueOnce(new Error('connection terminated unexpectedly'))
      const failed = await tick()
      spy.mockRestore()
      expect(failed.status).toBe(500)
      expect(failed.row).toMatchObject({ outcome: 'http_error', status_code: 500 })
      expect((await state(a.id)).status).toBe('SCHEDULED')

      const healed = await tick()
      expect(healed.row).toMatchObject({ outcome: 'success', articles_published: 1 })
      expect((await state(a.id)).status).toBe('PUBLISHED')
    })
  })

  // ── non-fatal warnings ────────────────────────────────────────────────────────────────────────
  describe('non-fatal warnings stay visible without undoing the publication', () => {
    it('an email failure publishes the article, still notifies, and is counted as a warning', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(MIN) })
      sendEmail.mockRejectedValue(new Error('Resend: 429 rate limited'))
      const { status, body, row } = await tick()
      expect(status).toBe(200)
      expect(JSON.parse(body!).warnings).toEqual([expect.objectContaining({ articleId: a.id, stage: 'email' })])
      expect(row).toMatchObject({ outcome: 'success', articles_published: 1, warning_count: 1 })
      expect((await state(a.id)).status).toBe('PUBLISHED')
      expect(await db.notification.count({ where: { articleId: a.id, type: 'published' } })).toBe(1)
    })

    it('a notification failure publishes the article, still emails, and is counted as a warning', async () => {
      const a = await article('SCHEDULED', { scheduledAt: ago(MIN) })
      const spy = vi.spyOn(db.notification, 'create').mockRejectedValueOnce(new Error('deadlock detected'))
      const { body, row } = await tick()
      spy.mockRestore()
      expect(JSON.parse(body!).warnings).toEqual([expect.objectContaining({ articleId: a.id, stage: 'notification' })])
      expect(row).toMatchObject({ outcome: 'success', articles_published: 1, warning_count: 1 })
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect((await state(a.id)).status).toBe('PUBLISHED')
    })

    it('one failing article does not stop the others', async () => {
      const first = await article('SCHEDULED', { scheduledAt: ago(5 * MIN) })
      const second = await article('SCHEDULED', { scheduledAt: ago(MIN) })
      sendEmail.mockRejectedValueOnce(new Error('boom'))
      const { row } = await tick()
      expect(row).toMatchObject({ articles_published: 2, warning_count: 1 })
      expect((await state(first.id)).status).toBe('PUBLISHED')
      expect((await state(second.id)).status).toBe('PUBLISHED')
    })
  })

  // ── the monitoring layers can each be told apart ──────────────────────────────────────────────
  describe('delivery and execution are separately visible', () => {
    it('a 200 that is not the endpoint\'s JSON (a CDN or maintenance page) is bad_response, not success', async () => {
      const { row } = await tick({ status: 200, body: '<html><title>Maintenance</title></html>' })
      expect(row).toMatchObject({ outcome: 'bad_response', status_code: 200, articles_published: null })
    })

    it('a JSON 200 that is not the endpoint\'s shape is bad_response too', async () => {
      expect((await tick({ status: 200, body: '{"ok":true}' })).row.outcome).toBe('bad_response')
      expect((await tick({ status: 200, body: '[]' })).row.outcome).toBe('bad_response')
    })

    it('an unparseable body can never stop the reconciler from classifying the rest', async () => {
      // (a Postgres text value cannot hold NUL, so a real pg_net body cannot either)
      expect((await tick({ status: 200, body: '{not json' })).row.outcome).toBe('bad_response')
      expect((await tick({ status: 200, body: '{"due": "many", "published": 1e999}' })).row.outcome).toBe('bad_response')
      expect((await tick()).row.outcome).toBe('success')
    })

    it('a pg_net failure to queue is recorded as not_sent, and the secret is redacted from the record', async () => {
      await q(`update net.stub_mode set mode = 'raise'`)
      const { rid, row } = await tick()
      expect(rid).toBeNull()
      expect(row.outcome).toBe('not_sent')
      expect(row.error).toMatch(/could not be queued/i)
      expect(row.error).not.toContain(VAULT_SECRET)
    })

    it('cron.job_run_details older than 7 days is pruned by the scheduled command, recent and running rows are kept', async () => {
      const job = await one<{ command: string; schedule: string }>(`select command, schedule from cron.job where jobname = 'prune-cron-run-details'`)
      expect(job.schedule).toBe('23 3 * * *')
      await q(`insert into cron.job_run_details (jobid, status, start_time, end_time) values
        (1, 'succeeded', now() - interval '8 days', now() - interval '8 days'),
        (1, 'succeeded', now() - interval '6 days', now() - interval '6 days'),
        (1, 'running',   now() - interval '1 minute', null),
        (1, 'running',   now() - interval '9 days', null)`)
      await q(job.command)
      const left = (await q(`select status, start_time > now() - interval '7 days' as recent from cron.job_run_details order by start_time`)).rows
      expect(left).toEqual([{ status: 'succeeded', recent: true }, { status: 'running', recent: true }])
    })
  })

  // ── secrecy ───────────────────────────────────────────────────────────────────────────────────
  describe('the secret appears nowhere it should not', () => {
    it('is absent from every response, every stored record, every log line and every cron command', async () => {
      await article('SCHEDULED', { scheduledAt: ago(MIN) })
      sendEmail.mockRejectedValueOnce(new Error('transport failure'))
      const ok = await tick()
      await q(`update vault.secrets set secret = 'wrong-value' where name = 'cron_secret'`)
      const bad = await tick()
      await q(`update net.stub_mode set mode = 'raise'`)
      await tick()

      expect(ok.body).not.toContain(VAULT_SECRET)
      expect(bad.body).not.toContain(VAULT_SECRET)
      const stored = await q(`select coalesce(response_body,'') || coalesce(error,'') as t from public.scheduler_invocations`)
      for (const r of stored.rows) expect(r.t).not.toContain(VAULT_SECRET)
      for (const line of logged) expect(line).not.toContain(VAULT_SECRET)
      expect((await one<{ n: string }>(`select count(*) n from cron.job where command like '%${VAULT_SECRET}%'`)).n).toBe('0')
      expect((await one<{ n: string }>(`select count(*) n from pg_proc where prosrc like '%${VAULT_SECRET}%'`)).n).toBe('0')
    })
  })
})
