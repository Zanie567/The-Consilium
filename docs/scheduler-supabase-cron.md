# Scheduled publishing: Supabase Cron runbook

Scheduled articles are published by `POST https://www.theconsilium.co.uk/api/publish-scheduled`
every 5 minutes. The trigger is **Supabase Cron (`pg_cron`) + `pg_net`**, not GitHub Actions.

## Why not GitHub Actions or Vercel Cron

- GitHub's `schedule:` is best-effort. On this repository it ran the hourly workflow every 4-5 hours
  and the daily one about 6 hours late (observed 2026-10-07); the publisher itself ran roughly every
  2 hours in May. A scheduled article could publish hours late.
- Vercel Cron on the Hobby plan cannot run every 5 minutes.
- Supabase Cron runs inside the database and fires on the minute.

## Pieces (all in `supabase/migrations/`)

| File | Does | Applied when |
|---|---|---|
| `20261007120000_scheduler_cron_infrastructure.sql` | enables `pg_cron` + `pg_net`; creates `public.scheduler_invocations`, `public.invoke_publish_scheduled()`, `public.reconcile_scheduler_invocations()`; schedules only the 1-minute **reconciler** | step 2 below |
| `20261007120100_scheduler_cron_enable_publish.sql` | schedules the **publisher** at `*/5 * * * *` | step 5 below, after a controlled call succeeds |

Nothing in these files contains the secret. `invoke_publish_scheduled()` reads Vault entry `cron_secret`
at call time. It is `SECURITY DEFINER`, `search_path = ''`, and executable by the owner only (revoked from
`PUBLIC`, `anon`, `authenticated`), so it cannot be called through PostgREST `/rpc`.

## Install order (production)

Never skip a step; stop and report if one fails.

1. **Purge fix merged, deployed and verified** (PR #118). Enabling a 5-minute publisher must never again
   be able to delete data.
2. Apply `20261007120000_scheduler_cron_infrastructure.sql`. Verify: extensions installed, table and both
   functions exist, RLS on, reconciler job present (queries below).
3. **Create the Vault secret and put the same value in Vercel and GitHub.** The existing `CRON_SECRET` is a
   write-only "sensitive" Vercel variable, so it cannot be read back. Rotate once, in all three places, without
   the value ever appearing on screen or in a file:
   1. `openssl rand -hex 32 | pbcopy`  (clipboard only)
   2. Supabase Dashboard > Integrations > **Vault** > Add secret: name `cron_secret`, paste. Use the Vault UI,
      not the SQL editor, because the SQL editor keeps query history that would contain the value.
   3. `pbpaste | vercel env update CRON_SECRET production --yes`
   4. `pbpaste | gh secret set CRON_SECRET --repo Zanie567/The-Consilium`
   5. `pbcopy < /dev/null`  (clear the clipboard)
   6. Redeploy production (an env change only reaches a new deployment) and confirm READY.
4. **Controlled invocation:** `select public.invoke_publish_scheduled();` returns a request id. Within about a
   minute the reconciler fills `status_code`. Expect **200** and a body containing `"published":0`. A 401 means
   Vault and Vercel hold different values; a 307 means the host is not the canonical `www`.
5. Apply `20261007120100_scheduler_cron_enable_publish.sql`. Verify at least 3 consecutive automatic runs,
   about 5 minutes apart, all 200.
6. **Remove the GitHub schedule:** delete the `schedule:` block from `.github/workflows/publish-scheduled.yml`
   and keep `workflow_dispatch` as the manual fallback. Do not leave two automatic 5-minute schedulers active.
   The scheduled-workflow guard test pins the expected cron set, so update it in the same change.

## Verification queries (read-only)

Never select from `vault.decrypted_secrets`. To confirm the secret exists without reading it:

```sql
select name, created_at, updated_at from vault.secrets where name = 'cron_secret';
```

Recent invocations and their HTTP outcome (this is the source of truth, not `cron.job_run_details`):

```sql
select id, invoked_at, request_id, status_code, left(response_body, 120) as body, error, completed_at
from public.scheduler_invocations
where job = 'publish-scheduled'
order by id desc
limit 20;
```

Failures in the last 24 hours (anything that is not a 200):

```sql
select invoked_at, status_code, error, left(response_body, 200) as body
from public.scheduler_invocations
where job = 'publish-scheduled'
  and invoked_at > now() - interval '24 hours'
  and (status_code is distinct from 200)
order by invoked_at desc;
```

Cadence: gaps between consecutive automatic runs (expect about 300 seconds):

```sql
select invoked_at,
       extract(epoch from invoked_at - lag(invoked_at) over (order by invoked_at))::int as gap_seconds
from public.scheduler_invocations
where job = 'publish-scheduled' and invoked_at > now() - interval '2 hours'
order by invoked_at desc;
```

Did `pg_cron` itself run the job? This only shows that `select public.invoke_publish_scheduled()` executed,
not that the HTTP call succeeded:

```sql
select d.start_time, d.end_time, d.status, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'publish-scheduled'
order by d.start_time desc
limit 20;
```

Jobs registered:

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
```

## Failure modes

| Symptom | Meaning |
|---|---|
| no new `scheduler_invocations` rows | job not scheduled, `pg_cron` not running, or the function is erroring: check `cron.job_run_details` |
| row with `error = 'vault secret "cron_secret" is missing...'` | Vault entry missing or renamed; no request was sent |
| `status_code = 401` | Vault `cron_secret` differs from the production `CRON_SECRET` (or Vercel was not redeployed) |
| `status_code = 307` | wrong host; must be `https://www.theconsilium.co.uk` |
| `status_code = 500` | the endpoint failed: see Vercel runtime logs for `/api/publish-scheduled` |
| `error = 'request timed out'` | the app took more than 30 s |
| `error = 'no response recorded by pg_net'` | the response never arrived within 10 minutes |

`pg_net` keeps raw responses for 6 hours (`pg_net.ttl`); `scheduler_invocations` keeps 30 days.

## Rotating the secret

Repeat step 3 above, but update the existing Vault entry in the Vault UI instead of adding one. Vault,
Vercel and GitHub (`CRON_SECRET`, also used by the streak, engagement, trophy and purge workflows) must
change together, followed by a Vercel redeploy.

## Rollback

```sql
select cron.unschedule('publish-scheduled');
```

and re-add the `schedule:` trigger to `publish-scheduled.yml`. The plumbing can stay; it is inert while
nothing is scheduled. To remove it entirely: `select cron.unschedule('reconcile-scheduler-invocations');`
then drop the two functions and `public.scheduler_invocations`.

## Notes

- `cron.timezone` is GMT; `*/5 * * * *` is timezone-independent.
- The endpoint is idempotent (compare-and-set per article), so an overlapping or retried call cannot
  double-publish.
- Trash purging is a separate daily job (`purge-trash.yml`, `POST /api/cron/purge-trash`); publishing never deletes.
