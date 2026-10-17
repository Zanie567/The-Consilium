# Corrections: production migration and release runbook

**Nothing here has been run against production.** Each step that writes to production needs the owner's explicit
approval at the time. Production Supabase project: `scllbuwkcqtmfogsgalt` (eu-west-1, PostgreSQL 17.6).

## What changes

| Layer | Change | Reversible by |
|---|---|---|
| Database | Migration `20261017120000_article_corrections.sql`: two enums, table `article_corrections`, constraints, one partial unique index, trigger `article_corrections_protect`, RLS on, legacy backfill (0 rows in production on 2026-10-17). Additive: no existing table, column or row is altered. | `supabase/manual/20261017120000_article_corrections_rollback.sql` |
| Application | Manage corrections, public notices, policy text, closed bypasses (see `AUDIT-AND-DESIGN.md`) | Promoting the previous Vercel deployment |

Scheduler, cron jobs, Vault secrets, `CRON_SECRET` / `PUBLISH_CRON_SECRET`, GitHub workflows and the Supabase GitHub
integration settings are **not** touched.

## Order

**Migration first, then the code.** The current production code never reads the new table, so the migration is safe
under it. The new code is also defensive (public pages fall back to the legacy note; the deployment check reports the
missing trigger by name), but the editorial Manage corrections page needs the table.

## 0. Preconditions (owner)

1. Approval for this window.
2. A fresh verified backup, using the existing toolkit (`docs/remediation/backup-and-verify.md`:
   `scripts/backup/take-supabase-backup.sh` then `verify-supabase-backup.sh`). Do not proceed without "VERIFIED".
3. Confirm in the Supabase dashboard that the GitHub integration's **"Deploy to production" is still OFF** (it was
   switched off on 2026-10-16). If it were on, merging the PR would let the integration apply the migration itself,
   outside this runbook.
4. Never run `supabase db push` against production.
5. Connection string obtained the secret-safe way described in `backup-and-verify.md` (never typed on the command line).

## 1. Preflight (read-only)

```bash
psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/corrections/production/preflight.sql | tee preflight.txt
```

Every row must match its `expect` column (table and enums absent, version not recorded, registry 24 rows, no blocking
locks). Keep the **articles fingerprint**; it must be identical after the migration.

## 2. Apply (one transaction, self-verifying)

```bash
psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/corrections/production/apply.sql | tee apply.txt
```

`apply.sql` checks preconditions, runs the migration file verbatim (`\i`), then checks in the same transaction that
articles are byte-for-byte unchanged (fingerprint), the legacy backfill matches, the trigger, constraints, index and RLS
exist and `anon` cannot read the table. Any failure raises and nothing is committed. It sets `lock_timeout = 5s`: if
the site is busy and the lock cannot be taken, it fails cleanly; retry a little later. Expected final notice:
`corrections migration verified: 0 legacy row(s) migrated, articles unchanged`.

Then record the version in the migration registry (registry row only; executes no SQL), as for previous hand-applied
migrations (`docs/remediation/migration-registry.md`, step 3):

```bash
supabase migration repair --status applied 20261017120000 --db-url "$DB"
supabase migration list --db-url "$DB"   # 20261017120000 now local = remote
```

## 3. Verify (read-only)

```bash
psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/corrections/production/verify.sql | tee verify.txt
```

Expect: table true, registry true, trigger enabled, RLS true, `anon` / `authenticated` cannot select, no rows (or only
legacy rows), no invented legacy dates, fingerprint identical to preflight.

## 4. Release the code

1. Merge the PR (owner). The merge auto-deploys production on Vercel.
2. Check the deployment is READY, then:
   - signed in as an administrator, `/api/admin/deployment-health` (also summarised on the admin overview) reports
     no `Missing corrections record` gap;
   - open any published article: it renders exactly as before (no correction notices exist yet);
   - `/corrections` shows the new policy text;
   - as an administrator, open **Editorial → Articles → Corrections** on any published article: the page loads with an
     empty history. **Do not publish a test correction on a real article**: a published notice is permanent by design.
   - in the article editor, a published article shows the "Live article" notice and does not autosave.
3. Optional end-to-end proof on production without touching real content needs a throwaway published article, which
   would itself be public. Not recommended; the lifecycle was proven on synthetic data (see the PR).

## Rollback

**Code only** (preferred, any time): promote the previous production deployment in Vercel. The old code ignores the
table. Corrections published meanwhile stay in the table, and because publishing mirrors `corrected` /
`correctionNote` on the article, the old page still shows a correction notice for them (the latest note only).

**Schema** (only after the code rollback, and only if needed):

```sql
SELECT count(*) FILTER (WHERE NOT legacy) AS issued_in_app, count(*) AS total FROM article_corrections;
```

If `issued_in_app > 0`, these are real public records: export them first
(`\copy (SELECT * FROM article_corrections ORDER BY "createdAt") TO 'article_corrections.csv' CSV HEADER`) and get the
Editor-in-Chief's approval. Then run `supabase/manual/20261017120000_article_corrections_rollback.sql` and
`supabase migration repair --status reverted 20261017120000 --db-url "$DB"`.

## Rehearsal evidence (2026-10-17, local, synthetic data)

On `public.ecr.aws/supabase/postgres:17.11.0.004` (the hosted image family; `postgres` is not a superuser, `anon` and
`authenticated` exist), with the pre-change Prisma schema plus production's RLS and column-grant migrations and a
synthetic 24-row registry:

- preflight: all checks as expected (one synthetic legacy article);
- apply: committed, `1 legacy row(s) migrated, articles unchanged`; fingerprint identical before and after;
- verify: trigger enabled, RLS on, `anon` / `authenticated` cannot select, no invented legacy dates;
- second apply: refused by the precondition, nothing changed;
- trigger as `postgres`: `UPDATE` and `DELETE` of a published row refused; deleting the article cascades;
- rollback file: committed, original article columns intact; re-apply after rollback: committed and verified.

Also on PostgreSQL 16: the migration applied to the pre-change schema and to a `prisma db push` of the new schema gives
byte-identical structures, and re-running it is a no-op.
