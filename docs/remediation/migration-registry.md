# Migration registry: what production really contains, and how to make the record trustworthy

Issue #129. Investigated 2026-10-14 with read-only queries against production (`scllbuwkcqtmfogsgalt`); the procedure
below was rehearsed only on disposable local databases. **Nothing here has been applied to production or to the
registry.** Steps marked *approval* need the owner's explicit go-ahead.

> **Never run `supabase db push` against production in the current state, and never follow the CLI's own suggestions:
> neither `migration repair --status reverted …` nor `db push --include-all`.** Section 2 shows what they would do.
>
> **Status:** step 1 (the folder) is done in the PR that adds this paragraph; the files now carry the names in the
> right-hand column of the step 1 table. Step 2 (the production registry) is **not** done and needs approval. Section 1
> below records the state as investigated, under the old file names. Older documents, and comments inside the SQL
> files themselves (left byte-identical on purpose), still use the old names; the step 1 table maps them.

## 1. Findings

**How the schema is built.** The base schema (every table) comes from Prisma (`prisma db push`), not from
`supabase/migrations`. The files in `supabase/migrations` are incremental changes on top of it (RLS, grants,
functions, triggers, extra columns and indexes) that were applied by hand: through the SQL editor or the Supabase
`execute_sql` / `apply_migration` API. The migrations folder therefore can never rebuild the database from empty on
its own, and the CLI registry can only ever be a ledger of those incremental changes.

**The registry** (`supabase_migrations.schema_migrations`) holds 4 rows, and none uses a repo file's version:

| Registry version | Name | What it is |
|---|---|---|
| `20260610222208` | add_comments_hiddenbody_and_debate_votes_anoniphash | applied through the API; **no repo file** (adds `comments.hiddenBody`, `debate_votes.anonIpHash` and its unique index; idempotent SQL recorded in the registry) |
| `20261003181523` | team_member_user_link | the same change as `20261001_team_member_user_link.sql`, applied through the API |
| `20261006234853` | public_appointments_testing_sessions | the same change as `20261003231314_public_appointments_testing_sessions.sql` |
| `20261006234931` | member_onboarding | the same change as `20261006_member_onboarding.sql` |

**What production actually contains** (signature objects checked one by one, read-only): every file in
`supabase/migrations` is applied **except the two Supabase Cron files** (`20261007120000_scheduler_cron_infrastructure`,
`20261007120100_scheduler_cron_enable_publish`), which are prepared but deliberately not applied (PR #120: GitHub
Actions remains the only publisher). The rollback `20261005_user_display_titles_rollback.sql` has, correctly, never
been run (`users.displayTitles` exists).

| File | In production | Notes |
|---|---|---|
| `20260408_enable_rls`, `20260903_enable_rls_remaining_tables` | yes | RLS on all 41 tables |
| `20260408_restrict_column_grants` | yes | anon: SELECT on 41 vetted columns of 6 tables; no table-level grant |
| `20261001_team_member_user_link` | yes | recorded as `20261003181523` |
| `20261003231314_public_appointments_testing_sessions` | yes | recorded as `20261006234853` |
| `20261005_user_display_titles` | yes | |
| `20261005_user_display_titles_rollback` | **no, and must never be** | a rollback script inside `migrations/` |
| `20261006_member_onboarding` | yes | recorded as `20261006234931` |
| `20261006153514` … `20261006161505` (4 files) | yes | |
| `20261007120000`, `20261007120100` (Supabase Cron) | **no, by decision** | |
| `20261010_debate_lifecycle`, `20261010_team_member_updated_at`, `20261011_…guard`, `20261012100000_…marker`, `20261012110000_…revoke` | yes | applied 2026-10-13 with guarded `execute_sql` |
| `add_article_comments`, `add_article_comments_quoted_text` | yes | no version in the name: the CLI skips them |

**Irregularities in the folder**, as the CLI sees them (it takes the leading digits as the version):
`20260408` ×2, `20261005` ×2 (one of them the rollback) and `20261010` ×2 are duplicate versions; two files have no
version; the rollback would run *forward*.

The hosted test project `consilium-testing` has its own registry (10 rows, also API-generated versions and names);
it is reconciled the same way, separately.

## 2. Safety facts proven on a disposable database

`scripts/db/rehearse-migration-registry.sh` (local server only; it refuses any other host) seeds a registry identical
to production's and runs the real Supabase CLI (2.120.0) against a scratch copy of the folder. It checks each fact
below and exits non-zero if one fails.

**Before step 1** (the folder as it was; investigation of 2026-10-14):

* `supabase db push --dry-run` refused (`DbPushMissingLocalError`): nothing could be pushed by accident.
* **Following the CLI's suggestion** (`migration repair --status reverted` of the 4 rows), a push would have run all 19
  files in order: re-run every applied change, run the rollback (dropping `users.displayTitles`, its check function and
  policy) right after the change it undoes, and switch on Supabase Cron, which was never approved.

**After step 1, before step 2** (the folder in the repo now; production's registry unchanged):

* Every local version is unique, the rollback is out of `migrations/`, and each of production's 4 registry rows has a
  matching file.
* `db push --dry-run` still refuses, now with `DbPushMissingRemoteError`. **The CLI then suggests `--include-all`,
  which must never be used here:** it would run the 13 already-applied files older than `20261006234931`, and with them
  everything newer that is not recorded, including the five admin-overhaul migrations and both Supabase Cron files.
  This window lasts until step 2 is done, so step 2 should follow the merge in the same sitting (or precede it; see
  step 2).

**After step 2** (rehearsed with the exact version list below):

* `migration repair --status applied` changed no database object (a fingerprint of every relation outside the
  registry is identical before and after) and the registry holds 22 rows.
* Only the two Supabase Cron files remain unrecorded; there are no remote-only rows.
* `db push` refuses the two older cron files (`DbPushMissingRemoteError`), and `--include-all` would pick up exactly
  those two files and nothing else.

The same script run against the folder as it was before step 1 fails every one of these checks, so it does not pass
by accident.

## 3. Reconciliation plan

### Step 1: tidy the folder (a reviewed PR; *approval*)

Renaming is safe for production because **no registry row refers to any of these names** (section 1); its only effects
are local: paths used by `scripts/setup-test-db.sh`, `scripts/run-e2e.sh` and the migration tests, which change in the
same PR, and open branches that touch these files, which must rebase.

1. Move `20261005_user_display_titles_rollback.sql` to `supabase/manual/` (rollbacks are run by hand, never forward).
2. Give each legacy file a unique 14-digit version that keeps the original order:

   | Now | Becomes |
   |---|---|
   | `20260408_enable_rls` | `20260408000000_enable_rls` |
   | `20260408_restrict_column_grants` | `20260408000100_restrict_column_grants` |
   | `20260903_enable_rls_remaining_tables` | `20260903000000_enable_rls_remaining_tables` |
   | `20261001_team_member_user_link` | `20261001000000_team_member_user_link` |
   | `20261005_user_display_titles` | `20261005000000_user_display_titles` |
   | `20261006_member_onboarding` | `20261006000000_member_onboarding` |
   | `20261010_debate_lifecycle` | `20261010000000_debate_lifecycle` |
   | `20261010_team_member_updated_at` | `20261010000100_team_member_updated_at` |
   | `20261011_hidden_debate_article_guard` | `20261011000000_hidden_debate_article_guard` |
   | `add_article_comments` | `20260511000000_add_article_comments` (added to git 2026-05-11) |
   | `add_article_comments_quoted_text` | `20260612000000_add_article_comments_quoted_text` (2026-06-12) |

3. Keep production's four registry rows as history by adding a file for each version:
   `20260610222208_add_comments_hiddenbody_and_debate_votes_anoniphash.sql` holds the exact idempotent SQL the
   registry recorded; the other three are comment-only "registry record" files pointing at the real file, so the same
   change is never applied twice.
4. `tests/unit/migration-files.test.ts` no longer has a frozen legacy list: every file must have a unique 14-digit
   version, no rollback may sit in `migrations/`, each of production's four API-recorded versions must have its file,
   and the three record-only files must contain no SQL.

Done: every renamed file is byte-identical to the original (SHA-256 checked), so no migration's SQL or behaviour
changes. The rollback keeps its name in `supabase/manual/`.

### Step 2: record what is applied (production registry write; *approval*)

After a fresh verified backup, using the session pooler connection, with the step-1 folder checked out. Do it in the
same sitting as the merge: either from the PR branch just before merging (until the merge, `main`'s old folder makes
`db push` refuse with `DbPushMissingLocalError`) or immediately after it, so the `--include-all` window in section 2
stays closed.

`repair --status applied` writes, for each version, one row with the version, the name (the file name after the
version) and the file's statements **as text**; it executes none of them. The rows production would gain are the 18
versions below; nothing else in the registry changes.

```bash
supabase migration list --db-url "$DB"        # expect: the 4 old rows matched, every other file local-only
supabase migration repair --status applied \
  20260408000000 20260408000100 20260511000000 20260612000000 20260903000000 20261001000000 20261003231314 \
  20261005000000 20261006000000 20261006153514 20261006160355 20261006161413 20261006161505 \
  20261010000000 20261010000100 20261011000000 20261012100000 20261012110000 --db-url "$DB"
supabase migration list --db-url "$DB"        # expect: everything matched except 20261007120000 and 20261007120100
```

`repair --status applied` only inserts registry rows; it executes no migration SQL (proven in the rehearsal). Do not
pass the two cron versions. (`$DB` is read the same secret-safe way as in `backup-and-verify.md` step 4; never type the
password on the command line.) Repeat for `consilium-testing` with its own state.

### Step 3: the process from then on

* A new migration is one file named `<14-digit UTC timestamp>_<snake_case>.sql`, idempotent where possible, with its
  rollback in `supabase/manual/`. `tests/unit/migration-files.test.ts` enforces the naming in CI today.
* Before applying: fresh verified backup; `supabase db push --dry-run` must list **exactly** the intended file(s).
* Apply either with `supabase db push` (which records the version itself) or by hand with guards (as on 2026-10-13),
  immediately followed by `supabase migration repair --status applied <version>`. Either way, finish with
  `supabase migration list` showing local and remote aligned, and record it in the PR.
* The two Supabase Cron files stay unrecorded until the owner decides on Supabase Cron. Applying them later is an
  explicit `--include-all` (or a hand apply plus repair), never a side effect.

## 4. What is still open

Steps 1 and 2 need approval; until they are done, the registry remains a partial record and `db push` must not be run.
The read-only signature check used in section 1 can be repeated at any time to confirm the state before acting.
