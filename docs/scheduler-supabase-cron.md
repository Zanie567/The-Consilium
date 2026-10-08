# Scheduled publishing: Supabase Cron runbook

Scheduled articles are published by `POST https://www.theconsilium.co.uk/api/publish-scheduled`.
The proposed trigger is **Supabase Cron (`pg_cron`) + `pg_net`** every 5 minutes, replacing GitHub Actions.

> **Status: prepared, not applied.** Nothing in this document has been run against production. Until
> the activation steps below are completed, **GitHub Actions (`publish-scheduled.yml`) remains the only
> publisher.** The purge of expired trash is a separate job (`purge-trash.yml`) and is not touched by any step here.

```
pg_cron (inside Supabase Postgres)
  -> public.invoke_publish_scheduled()        reads Vault secret `publish_cron_secret`
  -> pg_net  net.http_post                    async; HTTPS POST, Bearer secret, 30 s timeout
  -> https://www.theconsilium.co.uk/api/publish-scheduled      (unchanged publishing logic)
  -> publishScheduledArticles()               compare-and-set per article, then email / notification / achievements
  <- JSON answer {due, published, skipped, warnings}
  -> net._http_response (kept 6 h by pg_net)  copied by the 1-minute reconciler into public.scheduler_invocations

GitHub Actions (hourly, independent of everything above)
  -> POST /api/cron/scheduler-health          reads articles + scheduler records; alerts by failing the run
```

## Why not GitHub Actions or Vercel Cron

- GitHub's `schedule:` is best-effort. On this repository it ran the hourly workflow every 4-5 hours
  and the daily one about 6 hours late (observed 2026-10-07); the publisher itself ran roughly every
  2 hours in May. A scheduled article could publish hours late.
- Vercel Cron on the Hobby plan cannot run every 5 minutes.
- Supabase Cron runs inside the database and fires on the minute.

## Two secrets, and what each can do

| Secret | Lives in | Sent by | Accepted by |
|---|---|---|---|
| `CRON_SECRET` (existing, **never rotated by this work**) | Vercel env, GitHub Actions secret | every GitHub cron workflow, including `purge-trash.yml` | every cron route, including purge-trash and the health check |
| `PUBLISH_CRON_SECRET` (new, publish-only) | Vercel env (sensitive), Supabase Vault as `publish_cron_secret` | Supabase Cron only | `/api/publish-scheduled` **and nothing else** |

`/api/publish-scheduled` accepts **either**. That is what keeps the transition safe: GitHub keeps publishing with
`CRON_SECRET` before, during and after Supabase is switched on, and rollback is one command. Every other route
authenticates with `verifyCronAuth`, which never reads `PUBLISH_CRON_SECRET`; a test enforces that no other module
mentions it and that purge-trash refuses it. So the secret that sits in Vault, and that `pg_net` briefly queues where
database login roles can read it (see below), cannot delete anything or run any other job.

The shared `CRON_SECRET` is never put in Vault, and the migrations never reference it.

## Pieces

| File | Does | Applied when |
|---|---|---|
| `supabase/migrations/20261007120000_scheduler_cron_infrastructure.sql` | enables `pg_cron` + `pg_net`; creates `public.scheduler_invocations`, `public.invoke_publish_scheduled()`, `public.reconcile_scheduler_invocations()`; schedules the 1-minute **reconciler** and the daily **history prune** (neither publishes anything) | Phase A, step A2 |
| `supabase/migrations/20261007120100_scheduler_cron_enable_publish.sql` | schedules the **publisher** (`v_schedule`, default `*/5 * * * *`) | Phase B, after a controlled call succeeds |
| `src/lib/cronAuth.ts` `verifyPublishCronAuth` | the publish route's two-secret check | deployed in Phase 0 |
| `src/lib/schedulerHealth.ts`, `src/app/api/cron/scheduler-health/route.ts`, `.github/workflows/scheduler-health.yml` | the independent monitor | deployed in Phase 0 |

Nothing in these files contains a secret. `invoke_publish_scheduled()` reads Vault entry `publish_cron_secret`
at call time. Both functions are `SECURITY DEFINER`, `search_path = ''`, and executable by the owner only
(revoked from `PUBLIC`, `anon`, `authenticated`, `service_role`), so they cannot be called through PostgREST `/rpc`.

## What is monitored, and where (five layers)

A successful `pg_cron` run proves only that a SQL statement ran. Each layer has its own source of truth:

| # | Question | Where to look | Healthy value |
|---|---|---|---|
| 1 | Did cron fire? | `cron.job_run_details` (7 days kept) | `succeeded`, about every 5 minutes |
| 2 | Was the HTTP request delivered? | `scheduler_invocations.status_code` / `outcome` | any status code; not `timeout`, `network_error`, `lost`, `not_sent` |
| 3 | Did the publishing endpoint execute? | `scheduler_invocations.outcome` | `success` (2xx **and** the endpoint's own JSON) |
| 4 | Were articles published? | `articles_due`, `articles_published` | equal, unless a concurrent run published first |
| 5 | Was anything non-fatal wrong (author email, notification, achievement)? | `warning_count`, and `warnings` inside `response_body` | `0` |

`success` means layers 2 and 3 only. Layer 5 is a separate number so a publication that went out but whose
author email failed is visible without being treated as a failed run.

## Independent monitoring (alerts)

GitHub emails you when one of its runs fails; Supabase Cron has no equivalent on the Free plan. So the monitor
runs **outside** Supabase: `.github/workflows/scheduler-health.yml` calls `POST /api/cron/scheduler-health` hourly
(`23 * * * *`). The app reads its own database, so the check works whichever scheduler is publishing, and **keeps
working if Supabase Cron has died**. It only ever reads (plus one small audit row when it alerts or recovers); it never publishes.

| Problem key | Raised when | Typical cause |
|---|---|---|
| `articles_overdue` | a `SCHEDULED`, untrashed article is more than 15 minutes past its time | any scheduler failure; the backstop for all of them |
| `scheduler_stopped` | the Supabase publisher job is active but made no call for 15 minutes | `pg_cron` died, project paused, job erroring |
| `requests_failing` | the last 3 completed scheduler calls all failed (`auth_failure`, `http_error`, `timeout`, `network_error`, `lost`, `not_sent`, `bad_response`) | secret mismatch, site down, firewall |
| `repeated_warnings` | 2 or more runs with non-fatal warnings in 24 hours | email provider failing |
| `monitoring_blind` | the scheduler records exist but cannot be read | permissions changed; fix, or the other checks are blind |

**Few emails by design.** The endpoint remembers what it last alerted about (one `audit_logs` row, pruned after 30 days):
- a **new** set of problems alerts once (the run fails, GitHub emails you);
- the **same** problems do not alert again for 24 hours, then one reminder;
- a **changed** set (a new problem appears) alerts immediately;
- **recovery** is recorded once and the run passes.
A long outage is therefore one email plus a daily reminder, not 24 a day. A non-200 answer (the site or database itself is
down) fails every run, like the other cron workflows. An unreadable answer also fails: the check fails closed.

**What it logs.** The repository is public, so the Actions log is public. The response carries counts and ages only:
never an article title, id, URL, response body or secret. The step-by-step logic is tested by running the workflow's real shell step.

**Cost and limits.** 24 short runs a day, free on a public repository. It is not a real-time pager: GitHub's `schedule:` is
best-effort and has run hours late here, so a problem can be noticed late. Overdue articles are caught within about an hour
when GitHub is on time. If a stricter bound is ever needed, an external uptime monitor is the next step, not more GitHub runs.
To switch the monitor off: `gh workflow disable scheduler-health.yml --repo Zanie567/The-Consilium`.

**Before activation** it is already useful: it will flag any article GitHub left unpublished for more than 15 minutes.
Expect it to alert while GitHub's schedule is lagging; that is the scheduler problem this work exists to fix, not a fault in the monitor.
Thresholds live in one place, `THRESHOLDS` in `src/lib/schedulerHealth.ts`; keep `staleMinutes` above twice the publish interval.

## Security notes you must read before activating

1. **The secret is readable in `pg_net`'s queue for a moment.** Supabase documents that `net.http_post`
   stores the request, including its `Authorization` header, in `net.http_request_queue` until the worker sends
   it, and that any role that can use `pg_net` can read that row. By default that is `postgres` and any role you
   create with `login`, **not** `anon`/`authenticated`/`service_role` (they cannot connect directly and the Data API
   does not expose `net`). Vault protects the secret at rest only. Consequences: never add `net` to the exposed schemas in
   Dashboard > Settings > API, and give `login` only to roles you trust. What can leak is the publish-only secret, which is
   why it is dedicated. The reply is not an issue: `net._http_response` does not keep request headers.
2. **Rotation is not needed and not part of this plan.** `CRON_SECRET` is untouched. A *new* secret is created and added;
   nothing existing changes, so no other workflow can break.
3. The Vercel variable must be **Sensitive** (write-only) and **Production only**. Do not add it to Preview: Preview shares production data.
4. Never select from `vault.decrypted_secrets`. Never paste the secret into SQL, a migration, a ticket or chat. Create it in the Vault UI
   (the SQL editor keeps query history that would contain the value).

## Phase 0: ship the code (no scheduler change)

Merging and deploying PR #120 changes no scheduling. After deploy:
- `/api/publish-scheduled` accepts `CRON_SECRET` exactly as before, plus `PUBLISH_CRON_SECRET` once it exists.
- `/api/cron/scheduler-health` and the hourly health workflow go live. The workflow file lands with the merge, so if its first scheduled
  run fires before the deployment is READY it will fail once with a 404; wait for READY and ignore that single run.
- The health check may alert straight away if GitHub has left an article overdue. That is the monitor working, not a fault in it.
- **Verify GitHub is unaffected:** the next `Publish Scheduled Articles` run is green (HTTP 200). If it is not, roll the deployment back
  (`vercel rollback`, or promote the previous deployment); nothing else has changed.

## Phase A: install and prove the plumbing (GitHub keeps publishing)

Never skip a step; stop and report if one fails.

**A1. Preconditions.** Phase 0 is deployed and verified. The production deployment includes #117 (`ec2a4d5` or later), which holds
the compare-and-set that skips trashed and edited articles. Open an editorial-portal check that nothing important is scheduled in
the next 15 minutes, or accept that it would be published by GitHub anyway.

**A2. Apply** `20261007120000_scheduler_cron_infrastructure.sql` (Supabase `apply_migration` or the SQL editor).
Verify (queries below): extensions installed, table and both functions exist, RLS on, privilege check all `false`,
and exactly two jobs: `reconcile-scheduler-invocations` (`* * * * *`) and `prune-cron-run-details` (`23 3 * * *`).
No publisher job exists yet.

**A3. Create the dedicated secret.** Generate once, put the same value in Vault and in Vercel. `CRON_SECRET` is not read, changed or rotated.
1. `openssl rand -hex 32 | pbcopy`  (clipboard only; it appears nowhere on screen or in a file)
2. Supabase Dashboard > Integrations > **Vault** > Add secret: name `publish_cron_secret`, paste.
3. `pbpaste | vercel env add PUBLISH_CRON_SECRET production --sensitive`  (reads the value from stdin; do **not** pass `--force`, so nothing existing can be overwritten)
4. `pbcopy < /dev/null`  (clear the clipboard)
5. Redeploy production (an env change only reaches a new deployment) and confirm READY.
There is no GitHub secret to add: GitHub keeps using `CRON_SECRET`.

**A4. Supervised controlled invocation.** This is the one live call before the schedule exists. Be honest about what it is:
the endpoint is the real one, so it publishes anything that is **due when it runs**, and no pre-check can make that
impossible. A check followed by a call has a gap; an editor could schedule an article in it. What bounds the risk:

- The endpoint publishes only articles whose time has already passed, which is exactly the set GitHub's next run (at most 5 minutes
  away) would publish anyway. It cannot publish a draft, a trashed article or a future one (tested against a real database). The worst
  outcome is that one legitimately due article goes live a few minutes earlier than GitHub would have published it.
- The API accepts any future minute, not only the editor UI's "at least a minute ahead", so an article can in principle become due
  within seconds of being scheduled. The window below is therefore kept to seconds, not minutes.

Procedure:
1. **Freeze, briefly.** Ask the editors not to schedule, reschedule, restore from trash or approve anything for the next 5 minutes.
2. In the SQL editor, run this **one statement**. The check and the call are the same statement, so the gap is the statement itself plus
   `pg_net`'s delivery (seconds), not the time it takes you to read a result and press a button. It sends nothing if any article is due now
   or within 10 minutes. Times are compared in UTC explicitly, not in whatever time zone the session uses:

<!-- guarded-invocation -->
```sql
with due as (
  select count(*)::int as due_within_10_min
  from public.articles
  where status = 'SCHEDULED'
    and "deletedAt" is null
    and "scheduledAt" <= (now() at time zone 'utc') + interval '10 minutes'
)
select due_within_10_min,
       case when due_within_10_min = 0 then public.invoke_publish_scheduled() end as request_id
from due;
```

3. `request_id` empty and `due_within_10_min` above 0 means it **refused to send** (nothing was called, nothing is logged). Wait until nothing is due and run it again.
   A non-empty `request_id` means one request was queued.
4. Within about a minute the reconciler fills the row (read-only query below). Expect `outcome = 'success'`, `status_code = 200`,
   `articles_due = 0`, `articles_published = 0`.
   - `auth_failure`: Vault `publish_cron_secret` differs from Vercel `PUBLISH_CRON_SECRET`, or Vercel was not redeployed after A3.
   - `http_error` with 307: the host is not the canonical `www`. `bad_response`: a 200 that is not the endpoint's JSON (firewall, maintenance page).
   - `not_sent`: Vault secret missing/empty, or `pg_net` refused to queue it (`error` has the SQLSTATE; the secret is redacted).
5. If `articles_published` is above 0, that is not a malfunction: an article became due in the gap and was published, exactly as GitHub would have. Check it in the
   portal (it should be one the editors expected live) and note it. Then end the freeze.

A deliberately wrong Vault value is also a safe negative test: the route authenticates before touching the database, so `auth_failure` changes nothing.

## Phase B: enable, observe, then retire GitHub (a bounded, supervised overlap)

Two schedulers briefly overlap here by design. That is **safe** (each article is published by a one-row compare-and-set, proven by the
concurrent-run test) but it should be short and watched, not left running.

**B1. Apply** `20261007120100_scheduler_cron_enable_publish.sql`. It raises, scheduling nothing, unless the infrastructure,
the Vault secret `publish_cron_secret` (existence only), the reconciler job and a recorded successful controlled invocation all exist.

**B2. Observe at least 3 consecutive automatic runs** (about 15 minutes), all `success`, gaps near 300 s (cadence query below).
If any is not `success`, go to Rollback step 1 and stop.

**B3. Retire ONLY the GitHub article-publishing schedule**, reversibly:
```bash
gh workflow disable publish-scheduled.yml --repo Zanie567/The-Consilium
```
This leaves the file, `workflow_dispatch` and the other workflows (including `purge-trash.yml` and `scheduler-health.yml`) untouched, and is
undone with `gh workflow enable`. Confirm with `gh workflow list --all --repo Zanie567/The-Consilium` (disabled workflows are hidden without
`--all`) that only `Publish Scheduled Articles` shows as `disabled_manually` and the others are still `active`.
From now on the health workflow is what tells you if Supabase stops.

**B4. Confirm real publication.** At the next real scheduled article (or deliberately schedule a throwaway article a few minutes ahead from the
editorial portal and expect it live within 5 minutes):
- the article is `PUBLISHED` and visible on the site; the author got the "published" email and notification;
- `scheduler_invocations` shows that run with `articles_published >= 1` and `outcome = 'success'`;
- `warning_count = 0`, or the warning is understood;
- the next hourly `Scheduler Health Check` run is green.

**B5. After about a week of clean runs**, make the GitHub retirement permanent with a normal PR: delete the `schedule:` block from
`publish-scheduled.yml`, keep `workflow_dispatch`, and update `EXPECTED_CRONS` in `tests/unit/scheduled-workflow-guard.test.ts` in the same
change (the guard pins the expected schedule set on purpose). Until then it stays only *disabled*, which keeps rollback to one command.

**Optional Phase C (not recommended yet).** Making `/api/publish-scheduled` refuse `CRON_SECRET` entirely would mean only the publish-only
secret can publish. It would also break the GitHub fallback (which sends `CRON_SECRET`) unless that workflow is switched to the new secret first.
Do not do it while rollback to GitHub is still wanted; it gains little, because the dedicated secret already confines what leaks from Vault.

## Rollback (fast, in order)

1. Stop the Supabase publisher (instant, keeps everything, one statement):
   ```sql
   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'publish-scheduled'), active := false);
   ```
   (`select cron.unschedule('publish-scheduled');` removes it instead.) The health check treats a deactivated job as intentional and stays quiet about it.
2. Restore GitHub: `gh workflow enable publish-scheduled.yml --repo Zanie567/The-Consilium`, then trigger a catch-up run:
   `gh workflow run publish-scheduled.yml --repo Zanie567/The-Consilium`. It uses `CRON_SECRET`, which was never changed, so it works immediately.
3. Confirm the next run returns 200 and no article stayed overdue:
   ```sql
   select count(*) from public.articles
   where status = 'SCHEDULED' and "deletedAt" is null and "scheduledAt" < (now() at time zone 'utc');
   ```
4. Do **not** leave both active. The reconciler and the prune job can stay: they are inert without the publisher.
   To remove everything: `select cron.unschedule('reconcile-scheduler-invocations'); select cron.unschedule('prune-cron-run-details');`
   then drop the two functions and `public.scheduler_invocations`.
5. To remove the dedicated secret: delete the Vault entry in the Vault UI and remove the Vercel variable
   (`vercel env remove PUBLISH_CRON_SECRET production`), then redeploy. `/api/publish-scheduled` goes back to accepting only `CRON_SECRET`; nothing else changes.
6. To undo the code itself: revert the PR or promote the previous deployment. The publish route's `CRON_SECRET` path was never removed.

Nothing is lost by a rollback at any point: a scheduled article stays `SCHEDULED` until some run publishes it, and the next successful run of either
scheduler picks up every article whose time has passed.

## Changing the interval

The interval lives in one place: `v_schedule` at the top of `20261007120100_scheduler_cron_enable_publish.sql`
(standard 5-field cron, UTC; or `N seconds` for 1-59). For a **live** change without re-running the file:

```sql
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'publish-scheduled'),
  schedule := '*/10 * * * *'
);
```
Then edit `v_schedule` in the file in the same pull request so a fresh install matches production, and re-check cadence with the query below.
Keep it at one minute or slower: the `lost` threshold is 10 minutes, a sub-minute interval roughly doubles `cron.job_run_details` and
`scheduler_invocations` volume, and a run longer than the interval simply overlaps (safe, see Notes). If you go slower than every 5 minutes,
raise `staleMinutes` in `src/lib/schedulerHealth.ts` to stay above twice the interval, or the monitor will report a healthy scheduler as stopped.
`select * from cron.job where jobname = 'publish-scheduled';` shows what is live.

## Verification queries (read-only)

To confirm the secret exists without reading it:
```sql
select name, created_at, updated_at from vault.secrets where name = 'publish_cron_secret';
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
`since_last_success` above about 15 minutes means the scheduler is down or failing (the hourly health workflow reports the same).

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

Runs that published with non-fatal warnings (the detail is in `response_body`):
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

Did `pg_cron` itself run the job? This shows only that `select public.invoke_publish_scheduled()` executed, not that the HTTP call succeeded:
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
| `auth_failure` | 401/403: Vault `publish_cron_secret` differs from Vercel `PUBLISH_CRON_SECRET`, or Vercel was not redeployed after it was added |
| `http_error` | any other non-2xx: 307 means the wrong host (must be `https://www.theconsilium.co.uk`); 5xx means the endpoint failed, see Vercel runtime logs for `/api/publish-scheduled` |
| `timeout` | `pg_net` gave up after 30 s. The endpoint may still have finished (a run publishing many articles can exceed 30 s): check `articles` and the next row before assuming nothing was published |
| `network_error` | no status and no timeout: DNS, TLS or connection failure |
| `lost` | no response recorded by `pg_net` 10 minutes after the call (for example the unlogged `net` tables were wiped by a database restart) |
| `not_sent` | the call was never made: Vault `publish_cron_secret` missing or empty, or `pg_net` refused to queue it (`error` has the SQLSTATE; the secret is redacted) |

No new `scheduler_invocations` rows at all means the job is not scheduled, `pg_cron` is not running, or the function is erroring: check `cron.job_run_details`.

A failed or timed-out run never loses a publication: the article stays `SCHEDULED` and the next successful run publishes everything whose time has passed
(it records `publishedAt` as the time of that run, not the originally scheduled time).

## Retention, cost and Free-plan limits

| Data | Kept | Mechanism | Rough size |
|---|---|---|---|
| `public.scheduler_invocations` | 30 days | deleted by the publisher function on every call **and** by the reconciler, so it holds even if the reconciler stops | about 8,600 rows, a few MB, at 5-minute cadence |
| `cron.job_run_details` | 7 days | daily `prune-cron-run-details` job (`pg_cron` never prunes it; Supabase documents unbounded growth) | about 12,000 rows at 1,728 runs/day |
| `net._http_response` | 6 hours | `pg_net`'s own `pg_net.ttl` (default); unlogged table | tens of rows |
| `audit_logs` rows `scheduler_health.*` | 30 days | pruned whenever the health check writes one | a few rows per incident |

- **Cost: £0.** `pg_cron` and `pg_net` are included extensions, available on the Free plan (confirmed with the project's extension list: `pg_cron` 1.6.4 and `pg_net` 0.20.0
  are available, Vault 0.3.1 is installed). No Edge Function, no new provider. Traffic is about 288 small requests/day to Vercel for publishing plus 24 for the health check.
  **Retiring the GitHub schedule also removes about 8,640 workflow runs a month**, and the health check adds about 720.
- **Load:** one short statement per run plus a per-minute reconciler that touches only unreconciled rows. `pg_cron` supports 32 concurrent jobs; this uses 3 scheduled jobs.
- **Project pausing:** Free projects pause after about a week of *low database activity*. The publish endpoint's own query every 5 minutes counts as activity, but if the site
  is down and the project does get paused, **all** scheduling stops (as would GitHub's, because the site needs the database). The health workflow reports it (the check fails).
- **500 MB database limit:** the scheduler's footprint is under 20 MB in total with the retention above.
- **Logging volume:** the functions log nothing on success and one `WARNING` line on a missing secret or failure to queue.
- `pg_net` is documented as beta and can change its signatures; the controlled invocation (A4) is what proves the installed version works.

## Reproducing the tests

- `tests/unit/supabase-cron-migration.test.ts`: static checks on the migrations and this document.
- `tests/unit/cron-auth.test.ts`, `tests/unit/purge-trash-route.test.ts`: the dedicated secret, and that it cannot purge.
- `tests/unit/scheduler-health.test.ts`, `tests/unit/scheduler-health-workflow.test.ts`: the monitor's decision logic, and the workflow's real alert step.
- `tests/integration/scheduler-cron-sql.test.ts`: both migrations' real PL/pgSQL against a local Postgres with minimal stand-ins for `vault`, `net` and `cron`
  (database name must contain `cron_stub`; see the header of the file).
- `tests/integration/scheduler-end-to-end.test.ts`: the request the SQL generates, replayed against the **real route handlers and a real Prisma database**: authentication
  with both secrets, due/future/draft/trashed articles, repeated and concurrent runs, missed intervals, outages and recovery, warnings, every outcome, secret hygiene,
  **the guarded controlled invocation exactly as written above**, and the health check including alert de-duplication (database name must contain `sched_e2e`; see the header of the file).

None of them can prove the behaviour of the real extensions, the network path to Vercel, TLS or redirects. That is what the controlled invocation (A4) is for, and it is the
one test that cannot be run before the migration is applied.

## Notes

- `cron.timezone` is GMT; `*/5 * * * *` is timezone-independent. `scheduledAt` is stored and compared as a UTC instant; editors enter UK local time, which the application
  converts to UTC (and rejects non-existent daylight-saving times). SQL you run by hand must compare in UTC explicitly, as the statements above do.
- The endpoint is idempotent (compare-and-set per article), so an overlapping or retried call cannot double-publish. The compare-and-set repeats `deletedAt: null`
  and an `updatedAt` guard, so an article trashed or edited between the first query and the update is skipped (regression test: PR #121).
  One pre-existing limitation is unchanged: if the server process dies *between* marking an article published and sending its author email or notification, that
  email/notification is not retried (the article itself is published and nothing is duplicated).
- Trash purging is a separate daily job (`purge-trash.yml`, `POST /api/cron/purge-trash`); publishing never deletes.
