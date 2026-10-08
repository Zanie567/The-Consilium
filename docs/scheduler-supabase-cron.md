# Scheduled publishing: Supabase Cron runbook

Scheduled articles are published by `POST https://www.theconsilium.co.uk/api/publish-scheduled`.
The proposed trigger is **Supabase Cron (`pg_cron`) + `pg_net`** every 5 minutes, replacing GitHub Actions.

> **Status: prepared, not applied.** Nothing in this document has been run against production. Until
> the activation steps below are completed, **GitHub Actions (`publish-scheduled.yml`) remains the only
> publisher.** The purge of expired trash is a separate job (`purge-trash.yml`) and is not touched by any step here.

```
pg_cron (inside Supabase Postgres)
  -> public.invoke_publish_scheduled()        reads Vault secret `cron_secret`
  -> pg_net  net.http_post                    async; HTTPS POST, Bearer secret, 30 s timeout
  -> https://www.theconsilium.co.uk/api/publish-scheduled      (unchanged route and publishing logic)
  -> publishScheduledArticles()               compare-and-set per article, then email / notification / achievements
  <- JSON answer {due, published, skipped, warnings}
  -> net._http_response (kept 6 h by pg_net)  copied by the 1-minute reconciler into public.scheduler_invocations
```

## Why not GitHub Actions or Vercel Cron

- GitHub's `schedule:` is best-effort. On this repository it ran the hourly workflow every 4-5 hours
  and the daily one about 6 hours late (observed 2026-10-07); the publisher itself ran roughly every
  2 hours in May. A scheduled article could publish hours late.
- Vercel Cron on the Hobby plan cannot run every 5 minutes.
- Supabase Cron runs inside the database and fires on the minute.

## Pieces (all in `supabase/migrations/`)

| File | Does | Applied when |
|---|---|---|
| `20261007120000_scheduler_cron_infrastructure.sql` | enables `pg_cron` + `pg_net`; creates `public.scheduler_invocations`, `public.invoke_publish_scheduled()`, `public.reconcile_scheduler_invocations()`; schedules the 1-minute **reconciler** and the daily **history prune** (neither publishes anything) | Phase A, step A2 |
| `20261007120100_scheduler_cron_enable_publish.sql` | schedules the **publisher** (`v_schedule`, default `*/5 * * * *`) | Phase B, after a controlled call succeeds |

Nothing in these files contains the secret. `invoke_publish_scheduled()` reads Vault entry `cron_secret`
at call time. Both functions are `SECURITY DEFINER`, `search_path = ''`, and executable by the owner only
(revoked from `PUBLIC`, `anon`, `authenticated`, `service_role`), so they cannot be called through PostgREST `/rpc`.

## What is monitored, and where (five distinct layers)

A successful `pg_cron` run proves only that a SQL statement ran. Each layer below has its own source of truth:

| # | Question | Where to look | Healthy value |
|---|---|---|---|
| 1 | Did cron fire? | `cron.job_run_details` (7 days kept) | `succeeded`, about every 5 minutes |
| 2 | Was the HTTP request delivered? | `scheduler_invocations.status_code` / `outcome` | any status code; not `timeout`, `network_error`, `lost`, `not_sent` |
| 3 | Did the publishing endpoint execute? | `scheduler_invocations.outcome` | `success` (2xx **and** the endpoint's own JSON) |
| 4 | Were articles published? | `articles_due`, `articles_published` | equal, unless a concurrent run published first |
| 5 | Was anything non-fatal wrong (author email, notification, achievement)? | `warning_count`, and `warnings` inside `response_body` | `0` |

`success` therefore means layers 2 and 3 only. Layer 5 is a separate number so a publication that went out
but whose author email failed is visible without being treated as a failed run.

## Security notes you must read before activating

1. **The secret is readable in `pg_net`'s queue for a moment.** Supabase documents that `net.http_post`
   stores the request, including its `Authorization` header, in `net.http_request_queue` until the worker sends
   it, and that any role that can use `pg_net` can read that row. By default that is `postgres` and any role you
   create with `login`, **not** `anon`/`authenticated`/`service_role` (they cannot connect directly and the Data API
   does not expose `net`). Vault protects the secret at rest only. Consequences: never add `net` to the exposed schemas in
   Dashboard > Settings > API, and give `login` only to roles you trust. The reply is not an issue: `net._http_response`
   does not keep request headers.
2. **`CRON_SECRET` is shared.** The same value authorises every cron route, including `POST /api/cron/purge-trash`
   (which really deletes, and defaults to dry-run only for manual workflow runs). Putting it in Vault widens who can
   read it from "GitHub + Vercel" to "anyone able to read the pg_net queue". If that is not acceptable, the clean fix is a
   second secret accepted only by `/api/publish-scheduled`; that is an application change and is **not** part of this
   branch (see "Decisions" in the pull request).
3. **Rotation is a production-secret change.** Step A3 replaces `CRON_SECRET` in three places and redeploys. It needs
   your explicit go-ahead. If you still hold the current value, you can put that same value in Vault instead and skip
   the rotation entirely (the value must never be typed into the SQL editor, see below).
4. Never select from `vault.decrypted_secrets`. Never paste the secret into SQL, a migration, a ticket or chat.

## Phase A: install and prove the plumbing (GitHub keeps publishing)

Never skip a step; stop and report if one fails.

**A1. Preconditions.** PR #118 (purge split from publishing) is deployed to production and verified: `POST /api/publish-scheduled`
returns no `purged` key and `purge-trash.yml` is the only thing that deletes. Confirm the production deployment is
at or after commit `31a2053` (Vercel dashboard or `vercel ls`).

**A2. Apply** `20261007120000_scheduler_cron_infrastructure.sql` (Supabase `apply_migration` or the SQL editor).
Verify (queries below): extensions installed, table and both functions exist, RLS on, privilege check all `false`,
and exactly two jobs: `reconcile-scheduler-invocations` (`* * * * *`) and `prune-cron-run-details` (`23 3 * * *`).
No publisher job exists yet.

**A3. Create the Vault secret.** The existing `CRON_SECRET` is a write-only "sensitive" Vercel variable and cannot be read
back, so either rotate once in all three places, or reuse a value you hold. To rotate without the value appearing on screen
or in a file:
1. `openssl rand -hex 32 | pbcopy`  (clipboard only)
2. Supabase Dashboard > Integrations > **Vault** > Add secret: name `cron_secret`, paste. Use the Vault UI, not the
   SQL editor, because the SQL editor keeps query history that would contain the value.
3. `pbpaste | vercel env update CRON_SECRET production --sensitive --yes`  (reads the value from stdin)
4. `pbpaste | gh secret set CRON_SECRET --repo Zanie567/The-Consilium`  (reads the value from stdin)
5. `pbcopy < /dev/null`  (clear the clipboard)
6. Redeploy production (an env change only reaches a new deployment) and confirm READY.
Also used by the streak, engagement, trophy and purge workflows, which read the GitHub secret: they pick up the new value
on their next run, so the GitHub and Vercel updates must be done together.

**A4. Controlled invocation, without publishing real articles.** The endpoint is the real one, so a call publishes
anything that is due. Make the test a guaranteed no-op first:
```sql
-- must return 0: nothing is due now or within the next 10 minutes
select count(*) from public.articles
where status = 'SCHEDULED' and "deletedAt" is null and "scheduledAt" <= now() + interval '10 minutes';
```
If it is not 0, wait for the next gap (GitHub will publish those articles anyway). Then:
`select public.invoke_publish_scheduled();` returns a request id. Within about a minute the reconciler fills the row.
Expect `outcome = 'success'`, `status_code = 200`, `articles_due = 0`, `articles_published = 0`.
- `auth_failure`: Vault and Vercel hold different values.
- `http_error` with 307: the host is not the canonical `www`.
- `bad_response`: a 200 that is not the endpoint's JSON (a firewall, maintenance or redirect page).
- `not_sent`: Vault secret missing/empty, or `pg_net` refused to queue it (see `error`).

Because the Vercel route authenticates before touching the database, an `auth_failure` call changes nothing, so a
deliberately wrong secret is also a safe negative test.

## Phase B: enable, observe, then retire GitHub (a bounded, supervised overlap)

Two schedulers briefly overlap here by design; that is **safe** (each article is published by a one-row compare-and-set,
proven by the concurrent-run test) but it should be short and watched, not left running.

**B1. Apply** `20261007120100_scheduler_cron_enable_publish.sql`. It raises, scheduling nothing, unless the
infrastructure, the Vault secret (existence only), the reconciler job and a recorded successful controlled invocation
all exist.

**B2. Observe at least 3 consecutive automatic runs** (about 15 minutes), all `success`, gaps near 300 s
(cadence query below). If any is not `success`, go to Rollback step 1 and stop.

**B3. Retire ONLY the GitHub article-publishing schedule**, reversibly:
```bash
gh workflow disable publish-scheduled.yml --repo Zanie567/The-Consilium
```
This leaves the file, `workflow_dispatch` and the four other workflows (including `purge-trash.yml`) untouched, and is undone
with `gh workflow enable`. Confirm with `gh workflow list --all --repo Zanie567/The-Consilium` (disabled workflows are hidden without `--all`)
that only `Publish Scheduled Articles` shows as `disabled_manually` and the other four are still `active`.

**B4. Confirm real publication.** At the next real scheduled article (or deliberately schedule a throwaway article for a
few minutes ahead from the editorial portal and expect it live within 5 minutes):
- the article is `PUBLISHED` and visible on the site; the author got the "published" email and notification;
- `scheduler_invocations` shows that run with `articles_published >= 1` and `outcome = 'success'`;
- `warning_count = 0`, or the warning is understood.

**B5. After about a week of clean runs**, make it permanent with a normal PR: delete the `schedule:` block from
`publish-scheduled.yml`, keep `workflow_dispatch`, and update `EXPECTED_CRONS` in
`tests/unit/scheduled-workflow-guard.test.ts` in the same change (the guard pins the expected schedule set on purpose).
Until then the workflow stays only *disabled*, which keeps rollback to one command.

## Rollback (fast, in order)

1. Stop the Supabase publisher (instant, keeps everything, one statement):
   ```sql
   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'publish-scheduled'), active := false);
   ```
   (`select cron.unschedule('publish-scheduled');` removes it instead.)
2. Restore GitHub: `gh workflow enable publish-scheduled.yml --repo Zanie567/The-Consilium`, then trigger a catch-up run:
   `gh workflow run publish-scheduled.yml --repo Zanie567/The-Consilium`.
3. Confirm the next run in the Actions tab returns 200, and that no article stayed overdue
   (`status = 'SCHEDULED' and "scheduledAt" < now()`).
4. Do **not** leave both active. The reconciler and the prune job can stay: they are inert without the publisher.
   To remove everything: `select cron.unschedule('reconcile-scheduler-invocations'); select cron.unschedule('prune-cron-run-details');`
   then drop the two functions and `public.scheduler_invocations`. Remove the Vault entry in the Vault UI.

Nothing is lost by a rollback at any point: a scheduled article stays `SCHEDULED` until some run publishes it, and the next
successful run of either scheduler picks up every article whose time has passed.

## Changing the interval

The interval lives in one place: `v_schedule` at the top of `20261007120100_scheduler_cron_enable_publish.sql`
(standard 5-field cron, UTC; or `N seconds` for 1-59). For a **live** change without re-running the file:

```sql
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'publish-scheduled'),
  schedule := '*/10 * * * *'
);
```
Then edit `v_schedule` in the file in the same pull request so a fresh install matches production, and re-check cadence
with the query below. Keep it at one minute or slower: the `lost` threshold is 10 minutes, a sub-minute interval roughly doubles
`cron.job_run_details` and `scheduler_invocations` volume, and a run longer than the interval simply overlaps (safe, see Notes).
`select * from cron.job where jobname = 'publish-scheduled';` shows what is live.

## Verification queries (read-only)

To confirm the secret exists without reading it:
```sql
select name, created_at, updated_at from vault.secrets where name = 'cron_secret';
```

Recent invocations (this is the source of truth, not `cron.job_run_details`):
```sql
select id, invoked_at, outcome, status_code, articles_due, articles_published, warning_count,
       left(response_body, 120) as body, error, completed_at
from public.scheduler_invocations
where job = 'publish-scheduled'
order by id desc
limit 20;
```

One-glance health: age of the last good run, failures and warnings in the last 24 hours:
```sql
select
  (select max(invoked_at) from public.scheduler_invocations where job = 'publish-scheduled' and outcome = 'success') as last_success,
  now() - (select max(invoked_at) from public.scheduler_invocations where job = 'publish-scheduled' and outcome = 'success') as since_last_success,
  count(*) filter (where outcome not in ('success', 'pending'))        as failures_24h,
  count(*) filter (where outcome = 'success' and warning_count > 0)    as runs_with_warnings_24h,
  coalesce(sum(articles_published), 0)                                 as articles_published_24h
from public.scheduler_invocations
where job = 'publish-scheduled' and invoked_at > now() - interval '24 hours';
```
`since_last_success` above about 15 minutes means the scheduler is down or failing.

Outcome counts over the last 24 hours (every call lands in exactly one category):
```sql
select outcome, count(*) from public.scheduler_invocations
where job = 'publish-scheduled' and invoked_at > now() - interval '24 hours'
group by outcome order by outcome;
```

Failures in the last 24 hours (`pending` is normal for the newest row, for about a minute):
```sql
select invoked_at, outcome, status_code, error, left(response_body, 200) as body
from public.scheduler_invocations
where job = 'publish-scheduled'
  and invoked_at > now() - interval '24 hours'
  and outcome not in ('success', 'pending')
order by invoked_at desc;
```

Runs that published with non-fatal warnings (the detail is in `response_body`; titles are public article titles):
```sql
select invoked_at, articles_published, warning_count, left(response_body, 1000) as body
from public.scheduler_invocations
where job = 'publish-scheduled' and outcome = 'success' and warning_count > 0
order by invoked_at desc limit 20;
```

Privileges: every value in the result must be `false` (the API roles can neither run the functions nor read the log):
```sql
select r.role,
       has_function_privilege(r.role, 'public.invoke_publish_scheduled()', 'execute')        as can_invoke,
       has_function_privilege(r.role, 'public.reconcile_scheduler_invocations()', 'execute') as can_reconcile,
       has_table_privilege(r.role, 'public.scheduler_invocations', 'select')                 as can_read_log
from (values ('anon'), ('authenticated'), ('service_role')) as r(role);
```

Cadence: gaps between consecutive automatic runs (expect about 300 seconds):
```sql
select invoked_at,
       extract(epoch from invoked_at - lag(invoked_at) over (order by invoked_at))::int as gap_seconds
from public.scheduler_invocations
where job = 'publish-scheduled' and invoked_at > now() - interval '2 hours'
order by invoked_at desc;
```

Did `pg_cron` itself run the job? This shows only that `select public.invoke_publish_scheduled()` executed, not that
the HTTP call succeeded:
```sql
select d.start_time, d.end_time, d.status, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'publish-scheduled'
order by d.start_time desc
limit 20;
```

Jobs registered, and whether the `pg_cron` scheduler process is alive (no row means it died: fast-reboot the project):
```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
select pid, state, backend_start from pg_stat_activity where application_name ilike 'pg_cron scheduler';
```

## Failure modes

Each call is classified into exactly one `outcome`:

| `outcome` | Meaning and action |
|---|---|
| `pending` | queued, response not reconciled yet; normal for about a minute |
| `success` | 2xx **and** the body is the endpoint's JSON (an object with numeric `due` and `published`) |
| `bad_response` | 2xx but not the endpoint's JSON: a CDN, firewall or maintenance page answered 200, so the publisher did not run. Check the site and Vercel firewall |
| `auth_failure` | 401/403: Vault `cron_secret` differs from the production `CRON_SECRET`, or Vercel was not redeployed after rotation |
| `http_error` | any other non-2xx: 307 means the wrong host (must be `https://www.theconsilium.co.uk`); 5xx means the endpoint failed, see Vercel runtime logs for `/api/publish-scheduled` |
| `timeout` | `pg_net` gave up after 30 s. The endpoint may still have finished (a run publishing many articles can exceed 30 s): check `articles` and the next row before assuming nothing was published |
| `network_error` | no status and no timeout: DNS, TLS or connection failure |
| `lost` | no response recorded by `pg_net` 10 minutes after the call (for example the unlogged `net` tables were wiped by a database restart) |
| `not_sent` | the call was never made: Vault `cron_secret` missing or empty, or `pg_net` refused to queue it (`error` has the SQLSTATE; the secret is redacted) |

No new `scheduler_invocations` rows at all means the job is not scheduled, `pg_cron` is not running, or the
function is erroring: check `cron.job_run_details`.

A failed or timed-out run never loses a publication: the article stays `SCHEDULED` and the next successful run publishes
everything whose time has passed (it records `publishedAt` as the time of that run, not the originally scheduled time).

## Retention, cost and Free-plan limits

| Data | Kept | Mechanism | Rough size |
|---|---|---|---|
| `public.scheduler_invocations` | 30 days | deleted by the publisher function on every call **and** by the reconciler, so it holds even if the reconciler stops | about 8,600 rows, a few MB, at 5-minute cadence |
| `cron.job_run_details` | 7 days | daily `prune-cron-run-details` job (`pg_cron` never prunes it; Supabase documents unbounded growth) | about 12,000 rows at 1,728 runs/day |
| `net._http_response` | 6 hours | `pg_net`'s own `pg_net.ttl` (default); unlogged table | tens of rows |

- **Cost: £0.** `pg_cron` and `pg_net` are included extensions, available on the Free plan (confirmed with the project's extension list: `pg_cron` 1.6.4 and `pg_net` 0.20.0 are available, Vault 0.3.1 is installed). No Edge Function, no new provider.
  Traffic is about 288 small requests/day to Vercel (`/api/publish-scheduled`), well inside the Hobby plan.
- **Load:** one short statement per run plus a per-minute reconciler that touches only unreconciled rows. `pg_cron` supports 32 concurrent jobs; this uses 3 scheduled jobs.
- **Project pausing:** Free projects pause after about a week of *low database activity*. The publish endpoint's own query every 5 minutes counts
  as activity, but if the site is down and the project does get paused, **all** scheduling stops (as would GitHub's, because the site needs the database).
  Watch for Supabase's warning email, and `since_last_success` in the health query.
- **500 MB database limit:** the scheduler's footprint is under 20 MB in total with the retention above.
- **Logging volume:** the functions log nothing on success and one `WARNING` line on a missing secret or failure to queue.
- `pg_net` is documented as beta and can change its signatures; the controlled invocation (A4) is what proves the installed version works.

## Alerting: a known gap

GitHub Actions emails you when a run fails. Supabase Cron has no equivalent on the Free plan, so once GitHub is retired
**nothing pushes a notification when the scheduler fails**: failures are recorded (see above) but you must look. Until an alert exists,
run the one-glance health query daily and after any deployment. See "Decisions" in the pull request for the proposed fix.

## Reproducing the tests

- `tests/unit/supabase-cron-migration.test.ts`: static checks on the migrations and this document.
- `tests/integration/scheduler-cron-sql.test.ts`: both migrations' real PL/pgSQL against a local Postgres with minimal
  stand-ins for `vault`, `net` and `cron` (database name must contain `cron_stub`; see the header of the file).
- `tests/integration/scheduler-end-to-end.test.ts`: the request the SQL generates, replayed against the **real route handler and a real
  Prisma database**: authentication, due/future/draft/trashed articles, repeated and concurrent runs, missed intervals, outages and recovery,
  warnings, every outcome, secret hygiene (database name must contain `sched_e2e`; see the header of the file).

None of them can prove the behaviour of the real extensions, the network path to Vercel, TLS or redirects. That is what the controlled
invocation (A4) is for, and it is the one test that cannot be run before the migration is applied.

## Notes

- `cron.timezone` is GMT; `*/5 * * * *` is timezone-independent. `scheduledAt` is stored and compared as a UTC instant; editors enter UK local time,
  which the application converts to UTC (and rejects non-existent daylight-saving times).
- The endpoint is idempotent (compare-and-set per article), so an overlapping or retried call cannot double-publish.
  One pre-existing limitation is unchanged: if the server process dies *between* marking an article published and sending its author email
  or notification, that email/notification is not retried (the article itself is published and nothing is duplicated).
- Trash purging is a separate daily job (`purge-trash.yml`, `POST /api/cron/purge-trash`); publishing never deletes.
