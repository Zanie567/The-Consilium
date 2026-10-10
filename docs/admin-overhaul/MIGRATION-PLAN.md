# Admin overhaul: migration plan

Four additive, idempotent SQL files. **Nothing here has been applied to production.** The first three are applied to the hosted *testing*
project (`consilium-testing`, `zrieajoqosgzyesfatta`); the fourth is not applied anywhere except disposable local databases. This document does
not authorise anything: each hosted step needs its own approval.

## 1. The files, in application order

| # | File (`supabase/migrations/`) | Version the Supabase CLI parses | Requires | Adds | Production | Hosted testing project |
|---|---|---|---|---|---|---|
| 1 | `20261010_debate_lifecycle.sql` | `20261010` | the `debates` table | `debates.unpublishedAt`, `deletedAt`, `deletedById`, index `debates_deletedAt_unpublishedAt_idx` | **not applied** (columns absent; read-only catalog check, 2026-10-10) | applied; registry `20261010122238` `admin_overhaul_1_debate_lifecycle_20261010` |
| 2 | `20261010_team_member_updated_at.sql` | `20261010` (same as #1) | the `team_members` table | `team_members.updatedAt NOT NULL DEFAULT CURRENT_TIMESTAMP` | **not applied** | applied; registry `20261010122248` `admin_overhaul_2_team_member_updated_at_20261010` |
| 3 | `20261011_hidden_debate_article_guard.sql` | `20261011` | **#1** (reads `debates.unpublishedAt/deletedAt`) | `SECURITY DEFINER` trigger `articles_hidden_debate_guard`; archives any article already public inside a hidden debate (none exist today) | **not applied** (no trigger on `articles`, no function) | applied; registry `20261010122319` `admin_overhaul_3_hidden_debate_article_guard_20261011` |
| 4 | `20261012100000_article_hidden_by_debate_marker.sql` | `20261012100000` | the `articles` table; the application code needs #1 to #3 | `articles.hiddenByDebateAt` (nullable) and trigger `articles_clear_hidden_by_debate` | **not applied** | **not applied** (awaiting approval) |

Dependencies in one line: #3 needs #1; #2 is independent; #4 has no SQL dependency on #1 to #3 but is applied after them, and the new code needs all four.
Every statement uses `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP ... IF EXISTS`, so re-running any file is harmless.

Production and the code: **migrations first, then the deploy.** After each of #1 to #4 the *current* production code keeps working (every new column
is nullable or defaulted and unknown to it). The new code reports a missing item by name at `GET /api/admin/deployment-health` instead of failing.

## 2. Hosted testing project: what remains

Only **#4** is outstanding there. #1 to #3 are recorded as applied and their objects were confirmed present by a read-only catalog query
(columns, index, enabled trigger, `SECURITY DEFINER` function with a pinned `search_path`). Do not re-apply, rename or re-register #1 to #3.
The hosted code at `dpl_Dzsp2oGdRaecUB4tEHBM595r9v2i` is `7202db9` and does not know about #4; applying #4 first is safe for it (the column is
simply unused), and the newer code must not be deployed before #4 (see `STAGING-VERIFICATION.md`, section "Scope of hosted verification").

## 3. Production: order of operations (not authorised yet)

1. A verified database backup. (Staging data hashes are not a backup.)
2. Apply #1, #2, #3, #4 in that order, one at a time, by an operator through the Supabase SQL editor (the project's manual procedure). After each, run
   the read-only checks in section 5.
3. Deploy the application. Immediately check `GET /api/admin/deployment-health` as an administrator: 200 and `"gaps": []`.
4. Smoke test with a throw-away debate (unpublish, confirm both URLs 404, publish, confirm they return).

Hidden debates do not exist on production today (the lifecycle columns do not exist), so #3's "heal" statement changes nothing there, and #4 needs no
backfill. There is deliberately **no backfill** in #4: an article that is already `ARCHIVED` cannot be told apart from one an editor archived on
purpose, so such articles are never restored automatically.

## 4. The Supabase CLI and the duplicate version prefixes

Confirmed against the CLI source (`apps/cli-go/pkg/migration/file.go` and `history.go`, supabase/cli): a file name must match
`^([0-9]+)_(.*)\.sql$`; **the version is only the leading digits**, and `supabase_migrations.schema_migrations.version` is a `PRIMARY KEY`. Files that do
not start with digits (`add_article_comments.sql`, `add_article_comments_quoted_text.sql`) are skipped with a warning.

* The two `20261010_*` files (#1, #2) therefore **collide** if they are ever applied through the CLI: same version, primary-key conflict. They are not
  merely "the same calendar date".
* The repository already has the same collisions (`20260408_*` x2, `20261005_*` x2, one of which is a *rollback* script that a CLI run would treat as a
  forward migration), and `supabase/manual/` holds scripts that are not migrations at all. This is why migrations here have always been applied by hand
  and why the CLI must not be pointed at this repository.
* The hosted registries do not use the file prefixes anyway. The testing project recorded #1 to #3 as `20261010122238`, `20261010122248` and
  `20261010122319` (the time they were applied through the Supabase tooling). A CLI `db push` would see no local version matching any of those and would
  try to apply every file again. Production's registry is already known to be out of sync with its real schema (`docs/remediation/pr117-database-migrations.md`,
  section 8).
* #4 uses a unique 14-digit prefix so it would not collide, but that does not make the CLI safe for the files before it.

Decisions that need approval and have **not** been made: renaming #1 or #2 (they are already applied on staging; renaming would not change what staging
recorded), repairing either registry (`supabase migration repair`), or adopting the CLI. Nothing here renames or re-registers anything.

## 5. Read-only verification after each step (safe on any environment; they write nothing)

```sql
-- #1
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='debates'
  AND column_name IN ('unpublishedAt','deletedAt','deletedById') ORDER BY 1;                 -- 3 rows
-- #2
SELECT is_nullable, column_default FROM information_schema.columns
 WHERE table_schema='public' AND table_name='team_members' AND column_name='updatedAt';    -- NO, CURRENT_TIMESTAMP
-- #3
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='articles_hidden_debate_guard' AND NOT tgisinternal;   -- 1 row, 'O'
SELECT prosecdef, proconfig FROM pg_proc WHERE proname='prevent_hidden_debate_article_publication';          -- t, {search_path=public, pg_temp}
-- #4
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='articles' AND column_name='hiddenByDebateAt';                    -- YES
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='articles_clear_hidden_by_debate' AND NOT tgisinternal;  -- 1 row, 'O'
-- nothing hidden or marked before any debate has been hidden:
SELECT count(*) FROM articles WHERE "hiddenByDebateAt" IS NOT NULL;                                          -- 0
SELECT count(*) FROM debates WHERE "unpublishedAt" IS NOT NULL OR "deletedAt" IS NOT NULL;                   -- 0 on production
```

## 6. Rollback (only if required; each tested on a disposable database)

Code first: redeploy the previous build. The additive schema can stay. If the schema must go, in reverse order, per file header and
`tests/integration/admin-overhaul-migrations.test.ts` (`ROLLBACK`):

```sql
DROP TRIGGER IF EXISTS articles_clear_hidden_by_debate ON articles;     -- #4 (forgets which articles a debate hid; nothing else)
DROP FUNCTION IF EXISTS clear_article_hidden_by_debate();
ALTER TABLE articles DROP COLUMN IF EXISTS "hiddenByDebateAt";
DROP TRIGGER IF EXISTS articles_hidden_debate_guard ON articles;        -- #3 (removes the database guard)
DROP FUNCTION IF EXISTS prevent_hidden_debate_article_publication();
ALTER TABLE team_members DROP COLUMN IF EXISTS "updatedAt";             -- #2
DROP INDEX IF EXISTS "debates_deletedAt_unpublishedAt_idx";             -- #1 (discards unpublish/delete state only)
ALTER TABLE debates DROP COLUMN IF EXISTS "unpublishedAt", DROP COLUMN IF EXISTS "deletedAt", DROP COLUMN IF EXISTS "deletedById";
```

The rollback test restores the previous shape with every existing row byte-identical, and the four migrations then re-apply.
