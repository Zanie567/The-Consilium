# Corrections release: production rollout checklist

One page to follow on the day. The detail behind each step is in `PRODUCTION-RUNBOOK.md` (migration) and
`docs/remediation/backup-and-verify.md` (backup). **Every step that writes to production needs the Editor-in-Chief's
explicit approval at the time.** Never run `supabase db push`.

Order: approved prerequisites → fresh verified backup → preflight → migration (one guarded transaction) → registry
record → verification → merge (auto-deploys) → post-deploy checks. The migration must be in place before the merge.

## Not touched by this release (confirm, do not change)

- [ ] Supabase Cron jobs `publish-scheduled` (*/5), `reconcile-scheduler-invocations` (every minute) and
      `prune-cron-run-details` (daily): active, recent runs succeeded. Query in "Cron health" below.
- [ ] GitHub workflows: `publish-scheduled.yml` manual-only fallback; `scheduler-health.yml`, `purge-trash.yml` and
      the others on their schedules. PR #144 changes no workflow, cron, scheduler or secret file.
- [ ] Vault secret, `CRON_SECRET`, `PUBLISH_CRON_SECRET`: untouched.

## 0. Prerequisites

- [ ] Editor-in-Chief's approval of the release and of the prerequisite account changes (handled separately).
- [ ] PR #144: all CI checks green on the head commit; mergeable; no unresolved review threads.
- [ ] Supabase Dashboard → Integrations → GitHub: **"Deploy to production" is OFF** (and branching off). If it were on,
      the merge would apply migrations outside this procedure.
- [ ] Nobody is mid-way through editing a published article (the editor's behaviour changes at deploy).

## 1. Fresh verified backup (owner, on the Mac; `backup-and-verify.md`)

- [ ] Encrypted volume mounted (`/Volumes/ConsiliumBackup`), tools installed (steps 1–3).
- [ ] Step 5: run `scripts/backup/table-row-counts.sql` read-only in the SQL editor; export as the "before" CSV.
- [ ] Step 6: `scripts/backup/take-supabase-backup.sh --out /Volumes/ConsiliumBackup --url-from-env-file "$ENVFILE" --var DIRECT_URL`
      (connection string entered at the hidden prompt or from a private env file; never on the command line).
- [ ] Step 7: `scripts/backup/verify-supabase-backup.sh <backup folder> …` prints **VERIFIED**.
- [ ] Step 8: `scripts/backup/restore-rehearsal.sh` against the new backup passes (strongest check).
- [ ] Step 9: second verified copy made.
- [ ] Record the backup folder name and verification output (no secrets).

**Stop if any of these fails.**

## 2. Preflight (read-only)

- [ ] `psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/corrections/production/preflight.sql | tee preflight.txt`
- [ ] Every row matches its `expect` column. Last checked read-only on 2026-10-17: PostgreSQL 17.6; table, enums and
      function absent; registry 24 rows (latest `20261012110000`); 0 legacy corrections; `audit_logs` present with the
      columns the trigger writes; no blocking locks.

## 3. Apply (one transaction, self-verifying) and record

- [ ] `psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/corrections/production/apply.sql | tee apply.txt`
      → ends with `corrections migration verified: 0 legacy row(s) migrated, articles unchanged` and `COMMIT`.
      Any failed check rolls everything back; investigate before retrying.
- [ ] `supabase migration repair --status applied 20261017120000 --db-url "$DB"` (registry row only).
- [ ] `supabase migration list --db-url "$DB"`: `20261017120000` local = remote; nothing else changed.

## 4. Verify (read-only)

- [ ] `psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/corrections/production/verify.sql | tee verify.txt`
      → table, registry row, trigger enabled, RLS on, `anon`/`authenticated` cannot read, fingerprint equal to preflight.

## 5. Release the code

- [ ] Merge PR #144 (squash). Vercel builds and promotes production automatically.
- [ ] Deployment READY and aliased to the production domain.
- [ ] As an administrator: `/api/admin/deployment-health` shows no `Missing corrections record` gap.
- [ ] A published article renders as before (no notices exist yet); `/corrections` shows the new policy text.
- [ ] Editorial → Articles → **Corrections** on a published article opens with an empty history.
- [ ] A published article in the editor: "Live article" notice, no autosave, web address and byline disabled.
- [ ] **Do not publish a test correction on a real article** (published notices are permanent by design).
- [ ] Cron health query (below) after the deploy: publisher runs still `success`.

## Rollback

- Code: promote the previous production deployment in Vercel (tested; see the runbook's Rollback section and its
  editor instructions while rolled back).
- Schema: only after a code rollback, only with approval, per the runbook.

## Cron health (read-only)

```sql
SELECT j.jobname, j.schedule, j.active,
       (SELECT d.status || ' ' || d.start_time FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_run,
       (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status <> 'succeeded' AND d.start_time > now() - interval '24 hours') AS failures_24h
FROM cron.job j ORDER BY j.jobname;

SELECT count(*) AS invocations_24h, count(*) FILTER (WHERE outcome <> 'success') AS not_success, max(invoked_at) AS latest
FROM scheduler_invocations WHERE invoked_at > now() - interval '24 hours';
```

On 2026-10-17 (read-only): three jobs active with 0 failures in 24 h; 244 publisher invocations, all `success`.
