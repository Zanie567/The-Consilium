# Record: the PR #117 database remediation (completed 2026-10-09)

**Status: the four missing PR #117 migrations, and the older `article_comments` migration, have been applied to
production and the resulting database state has been independently verified read-only. This is now a record, not a plan.
Do not apply anything in this document again.** Several real-world smoke tests are still outstanding (section 5), so the
features are *deployable*, not yet proven end to end.

**Supabase's migration registry is out of sync with this (confirmed drift, section 8):** it has no recorded version for any of the migrations applied on 2026-10-09.
The schema is correct; the bookkeeping is not. **Do not re-run any migration or any rollback to "correct" the registry.** Repairing it is a separate decision, to be made after a read-only review of the precise migration history.

Files in this folder:

| File | Purpose | Safe against production? |
|---|---|---|
| `pr117-database-migrations.md` | this record | n/a |
| `pr117-verify-post-migration.sql` | **read-only** check that the remediation is still in place (one `SELECT`) | yes, any time |
| `historical/pr117-preflight-PRE-MIGRATION.sql` | the read-only pre-apply check from 2026-10-08; its "expect" column assumes the objects are absent | harmless (`SELECT` only) but its expectations are now wrong |
| `historical/pr117-rollback-DO-NOT-RUN-IN-PRODUCTION.sql` | the 2026-10-08 undo script; **would now break the deployed application**; refuses to run without an explicit acknowledgement | **no** |

## 1. Timeline at a glance

| When | What |
|---|---|
| 2026-10-08 (12:04 UTC) | PR #117 merged (`ec2a4d5`); its four migration files (timestamped 2026-10-06) and the code that needs them land in `main`. Merging to `main` deploys to production automatically; **nothing applied the migrations**, because this repository applies SQL by hand and keeps no migration history. |
| 2026-10-08 | Production found serving the #117 code (`ec2a4d5`) without any of #117's migrations, and without the older `article_comments` table. Plan, completeness checks and an isolated rehearsal written (sections 2 to 4, 6). Verified read-only; nothing applied. |
| 2026-10-09 | A verified, encrypted production backup was taken (section 7). The four migrations and the `article_comments` migration were applied. PR #124 (`/api/upload` sharp/libvips fix) was merged and deployed at `5c1406626b4b435794efdda0f2c2d831b289b85a`. |
| 2026-10-09 | The resulting state was independently re-verified read-only (section 4). |

## 2. What was broken on 8 October (historical)

Production served the code from PR #117 (`ec2a4d5`) but **none of #117's four database migrations were applied**. The code and the
database disagreed, and four features were affected. Nothing had been reported because nobody had hit them (Vercel's runtime-error log was empty since the
deploy), not because they worked.

| Feature (production, 2026-10-08) | What happened | Why |
|---|---|---|
| Newsletter sign-up (`POST /api/subscribe`) | failed for every visitor (HTTP 500) | called `public.consilium_subscriber_identity()`, which did not exist |
| Saving an article that has tags (`POST /api/articles`, `PUT /api/articles/[id]`) | failed for editors | called `public.consilium_tag_identity()`, which did not exist |
| Uploading an article image (`POST /api/upload`, bucket `article-images`) | failed for editors (HTTP 500, no orphan file left in Storage) | wrote a row to `article_image_assets`, which did not exist |
| Reading-time analytics collection | errored | `article_engagement_sessions` did not exist |
| Two new daily Vercel crons | returned a fixed 503 each day | same two tables |

Not affected then: scheduled publishing, public article pages, sign-in, and the trash purge. The purge only touches
`article_image_assets` for an article that references a *managed* image, and none could exist while uploads failed; if one had, that article's
deletion transaction would have rolled back, so the purge failed closed and never deleted wrongly.

A **fifth, older, separate gap** was found by the same check: `article_comments` (inline editorial comments, PR #97) did not exist in
production. Its migration (`supabase/migrations/add_article_comments.sql`) says "run BEFORE deploying" and had never been run. The review panel and the
editor load comments whenever an article is opened, so that feature had presumably been erroring since it shipped.

**Corrections to earlier statements.** The original PR description and an earlier version of this document said production "is" missing these tables and functions, that sign-up
"fails for every visitor", and that the procedure "has not been run". All of that described 8 October and is no longer true. Nothing in this section describes production today.

## 3. Evidence gathered before applying (historical, kept for the record)

### 3.1 Was the list complete? (three independent checks, 2026-10-08)

1. **Schema diff.** `git diff 31a2053..ec2a4d5 -- prisma/schema.prisma` changes exactly: two new models (`ArticleImageAsset`, `ArticleEngagementSession`), `ArticleTag.tag` to
   `onDelete: Restrict`, and one new index. No column was added to any existing table.
2. **Column drift against production.** All 305 columns of all 40 models in the deployed Prisma schema were compared with production's `information_schema` (read-only; only names returned).
   The only things missing: `article_image_assets`, `article_engagement_sessions` (both from #117) and `article_comments` (older, separate). Every other column existed.
3. **Prisma's own structural diff** of a database built from the pre-#117 schema plus these migrations against the deployed schema showed no missing column, type, nullability, uniqueness or default.
   The only remaining differences were cosmetic: two hand-written foreign keys lack `ON UPDATE CASCADE` (ids are never updated), and `article_comments` has differently named indexes.

What was **not** compared: index/constraint definitions of the ~35 tables not touched here, and column *types* in production (names only). Neither is touched by these migrations.
(A separate, older note, `docs/schema-drift-and-article-comments-plan.md`, covers index drift on `articles`; it predates this remediation and has not been revisited here.)

### 3.2 What each migration does

| # | File | Adds | Existing rows touched | Locks | Refuses when |
|---|---|---|---|---|---|
| 1 | `20261006153514_discovery_topic_identity` | function `consilium_tag_identity`; unique index on it over `tags`; index on `article_tags("tagId","articleId")`; replaces FK `article_tags_tagId_fkey` (`CASCADE` to `RESTRICT`) | none | brief `SHARE` on `tags` (index build); brief `ACCESS EXCLUSIVE` on `article_tags` while the FK is dropped and re-added | an empty canonical tag name, or two tags with the same canonical name |
| 2 | `20261006160355_managed_article_images` | table `article_image_assets` (+2 indexes, RLS on, no policies, `REVOKE ALL ... FROM PUBLIC`) | none | none (new table) | never |
| 3 | `20261006161413_normalized_subscriber_email` | function `consilium_subscriber_identity`; unique index on it over `subscribers` | none | brief `SHARE` on `subscribers` | two subscribers whose canonical email is equal |
| 4 | `20261006161505_article_active_engagement` | table `article_engagement_sessions` (+3 indexes, check constraint, RLS on, `REVOKE ALL ... FROM PUBLIC`, FK to `articles` with `CASCADE`) | none | none (new table) | never |

Each file runs inside its own `BEGIN ... COMMIT`, so a failure leaves nothing behind (tested). Every file is written to be safe to run again, **but there is no reason to re-run them now**:
migration 1 drops and re-adds a foreign key on `article_tags` each time, which takes a brief exclusive lock for no benefit.

**The one behaviour change:** deleting a tag that still has articles attached is now refused. No code deletes tags (verified by search).

**Dependencies.** The four are independent of each other and of the scheduler work (PR #120 reads only `articles` and `audit_logs`). The order used, and the order the rehearsal uses, is the file-name order above.
**Compatibility both ways:** the previous production code (`31a2053`) does not use these objects and tolerates them (they are additive).

### 3.3 Production data on 2026-10-08 (why the migrations' own preflights were expected to pass)

Measured read-only (counts only; no row contents were read):

| Fact | Value then |
|---|---|
| `tags` rows / `article_tags` rows | 0 / 0 |
| `subscribers` rows | 3 |
| subscriber canonical-duplicate groups / non-canonical stored emails / blank emails | 0 / 0 / 0 |
| `articles` rows (live) | 21 (18) |
| existing `article_tags_tagId_fkey` | present, `ON DELETE CASCADE` (replaced by name, not duplicated) |
| any of the new indexes already present | none |
| Postgres / encoding / collation | 17.6 / UTF8 / `en_US.UTF-8` (`normalize()` needs Postgres 13+ and UTF8) |
| database size | 15 MB |

**Tag identity parity on the real server.** The tag-identity function's exact expression was run inline on production (read-only) over 25 labels on 2026-10-08, and the JavaScript `canonicalTagSlug` was
checked to equal those answers (`tests/unit/tag-identity-production-parity.test.ts`, runs in every CI run). This matters because the unique index enforces the SQL value while the application computes the JavaScript value; a
disagreement would make saves fail or duplicates slip through. A developer laptop (macOS) disagrees with production on one Greek label, which is why the production server's own answers are the reference.
**Re-checked after applying (2026-10-09):** the *deployed* `public.consilium_tag_identity()` was run over the same 25 labels, read-only; **25 of 25 match**.

## 4. What is in production now (verified read-only, 2026-10-09)

These facts were checked directly against production project `scllbuwkcqtmfogsgalt` with read-only queries (catalog reads, counts and constant-input function calls; no row contents,
no writes, no privilege changes) while preparing this PR.

| Check | Result |
|---|---|
| `consilium_tag_identity(text)`, `consilium_subscriber_identity(text)` | present, `IMMUTABLE`, not `SECURITY DEFINER`; `consilium_subscriber_identity('  Reader@Example.Test ')` = `reader@example.test`, `consilium_tag_identity('Investment & Finance')` = `investment-finance` |
| `article_image_assets`, `article_engagement_sessions` | present |
| Eleven expected indexes (incl. both primary keys and `article_image_assets_path_key`) | all present; `tags_canonical_identity_key` and `subscribers_normalized_email_key` are `UNIQUE` |
| `article_tags_tagId_fkey` | exactly one, `ON DELETE RESTRICT` |
| `article_engagement_sessions` | FK to `articles` with `CASCADE`; `activeSeconds` check constraint present |
| Row-level security | enabled on both new tables, with **no policies** |
| Privileges | `anon`, `authenticated` and `PUBLIC` hold **no** table-level and **no** column-level privilege on either new table; only `postgres` and `service_role` hold any |
| `article_comments` | present, RLS enabled, one policy, `anon`/`authenticated` hold no privileges |
| Supabase migration registry (`list_migrations`) | **confirmed drift:** records no version for any of the four PR #117 migrations, nor for `article_comments` (section 8) |
| Row counts (counts only) | `article_image_assets` 0, `article_engagement_sessions` 0, `article_comments` 2, `tags` 3, `subscribers` 3 |
| Deployed tag function vs the 25-label parity table | 25 of 25 agree |
| `pr117-verify-post-migration.sql` run against production | 28 `ok`, 0 `FAIL`, 3 `info` |

Things stated by the owner and **not** re-verified by this review: that the migrations were applied on 9 October in the order of section 3.2; that the backup in section 7 was created and verified; that
the core `article_comments` functionality was exercised; that PR #124 is deployed at `5c14066`.

What the numbers imply, without over-reading them:

* `tags` went from 0 to 3 rows since 8 October, so tag creation has been exercised at least once by some path. Which path, and whether the full editor save flow and public tag pages work, was not examined here.
* `subscribers` is still 3, `article_image_assets` is 0 and `article_engagement_sessions` is 0. Nothing in the database shows a real sign-up, a managed image upload or a recorded reading session since the migrations were applied.
  That is consistent with the smoke tests below not having been run yet; it is not evidence that those features work.

## 5. What is NOT yet proven: real production smoke tests still outstanding

Having the database objects does **not** show the features work. Each item below is a real production write or observation; decide knowingly, use an address/article you own, and clean up afterwards.

| Feature | What would prove it | Cleanup note | Status |
|---|---|---|---|
| Newsletter sign-up | sign up with an address you own on the live site; expect success and, in `subscribers`, one new row; repeat in a different case/spacing and expect "Already subscribed" | the row can be deleted | **outstanding** |
| Saving an article with a tag | save a draft with a tag through the editor; expect success; reopen it; check the public tag/archive page | tags cannot be deleted while attached to an article | **outstanding** (3 tag rows exist, origin not examined) |
| Image upload (`/api/upload`, PR #124) | upload one image in the editor; expect success, one object in `article-images` and one `article_image_assets` row | a Storage object and a row are added | **outstanding** |
| Orphaned-image cleanup (`/api/cron/cleanup-article-images`, 03:00 UTC) | after an image is removed from all articles, confirm the cron eventually collects it (and not before its grace period) | none | **outstanding**, not testable until uploads exist |
| Reading analytics | read an article for a while on the live site; expect a row in `article_engagement_sessions` | rows are small | **outstanding** |
| The two daily crons (`cleanup-article-images` 03:00 UTC, `cleanup-reading-analytics` 04:00 UTC) | Vercel logs show HTTP 200 (not the earlier 503) on the first run after the migrations | none | **not checked by this review** |
| `article_comments` | add, reply to and resolve an inline comment on a draft | 2 rows exist (origin not examined) | owner reports core functionality tested; **not re-tested here** |

## 6. Security posture of the new tables, and why it holds today

The tables are server-only: the application reaches them through Prisma with the service credentials, never through the browser API roles. Protection is layered:

1. **No privileges for the API roles** (verified, section 4). New tables created by the `postgres` role in this project receive default privileges for `postgres` and `service_role` only; `anon` and `authenticated` get nothing.
2. **Row-level security is enabled with no policies**, so even if a grant were added by mistake the API roles would read and write nothing.
3. The migrations themselves only `REVOKE ALL ... FROM PUBLIC`; they do **not** explicitly revoke from `anon` and `authenticated`. Layer 1 therefore depends on the project's default-privilege configuration, not on the migration text.

Why this matters: tables created by a different role (for example `supabase_admin`) receive default grants to `anon` and `authenticated` in this project, as Supabase's standard defaults do. The rehearsal test models that
more permissive case (and shows RLS still blocks the API roles). `pr117-verify-post-migration.sql` fails if any API-role privilege appears on the two new tables.

## 7. Backup

Supabase takes **no automatic backups on the Free plan**, so a manual, verified backup is a prerequisite for any production schema change. On 2026-10-09 an encrypted backup was created and verified before applying
(per the owner). **It must not be modified or deleted** as part of this work or any follow-up; this record deliberately does not say where it is, and does not record which procedure produced it.

**This document does not carry a backup procedure.** An earlier version of it contained a short manual `supabase db dump` recipe. That recipe was removed so there is only one procedure to follow: the maintained runbook
[`docs/remediation/backup-and-verify.md`](backup-and-verify.md) and its scripts under [`scripts/backup/`](../../scripts/backup/) (added in PR #123, on `main`): secret-safe connection handling, an encrypted volume,
a verifier that checks checksums and per-table row counts, and a throwaway-database restore test. Follow the runbook, not any command remembered from an earlier draft of this file.

Two points from the 2026-10-08 plan still hold whichever procedure is used: `pg_dump` must be at least the server's major version (the server is 17), and the dump contains subscriber email addresses and must be encrypted at rest.

## 8. How it was applied, and the confirmed registry drift

The four files were applied one at a time, in file-name order, each as a single run of the whole file (each has its own `BEGIN`/`COMMIT`), stopping at the first error; then the optional, separate
`supabase/migrations/add_article_comments.sql`. This repository applies migrations by hand and keeps no migration history, which is why they were not applied by any deploy step in the first place.

**Confirmed migration-history drift.** Supabase's own migration registry (inspected read-only on 2026-10-09) lists four unrelated migrations (`add_comments_hiddenbody_and_debate_votes_anoniphash`, `team_member_user_link`,
`public_appointments_testing_sessions`, `member_onboarding`) and **records no version for any of the four PR #117 migrations**. It also records none for `article_comments`, so five applied migrations are missing in all.
The objects exist and are verified (section 4); the registry simply does not say so. This review did not determine how they were applied (a SQL-editor run, the repository's convention, would explain it).

Consequences:

* Tooling that trusts the registry (`supabase db push`, branch creation, `list_migrations`) will believe these five migrations are unapplied.
* **The migrations are already applied. Do not re-run them, and do not run any rollback, to correct the registry.** Re-running adds no safe bookkeeping, and migration 1 would needlessly re-take a brief exclusive lock on `article_tags`; a rollback would break production (section 10).
* **This PR does not repair the registry.** That is a separate decision, to be taken after a read-only review of the precise migration history (what is recorded, what versions and names would have to be recorded, and by what mechanism).

## 9. Rehearsal (isolated; nothing touched production)

`tests/integration/pr117-migrations-rehearsal.test.ts` (opt-in: `RUN_MIGRATION_REHEARSAL=1`, local server only, refuses any non-local host) builds a database from `tests/fixtures/pre-pr117-schema.sql`, the exact pre-#117 DDL
(generated from the Prisma schema at `31a2053`, minus `article_comments`, mirroring production as it was on 2026-10-08), seeds production-shaped data (3 subscribers, 21 articles, no tags), and runs the real application code.
**The fixture is frozen on purpose; it is not production today.** It is not run in CI (it needs a database server it may create databases on); run it locally when touching these migrations.

Original result on 2026-10-08: 13 of 13 passed. Re-run on 2026-10-09 against current `main` (after #124 and #125), unmodified: 13 of 13 passed; with the tests added by this PR: 20 of 20, plus the 25 parity tests.

| Scenario | Result |
|---|---|
| BEFORE: the real subscribe route and tag resolver against the pre-#117 database | reproduces the 2026-10-08 failure: sign-up returns 500, tag resolution throws "function does not exist" |
| Apply the four in order | no error; a few milliseconds each; adds exactly 2 functions, 2 tables, 11 indexes; FK becomes `RESTRICT` (replaced, not duplicated); no existing row changed |
| Replay twice more | no error, catalog identical |
| AFTER: every table and column the deployed Prisma schema expects exists | yes (apart from the separate `article_comments`) |
| AFTER: real code paths | sign-up returns 201, a case/space variant is "Already subscribed", the database itself rejects a twin; five spellings of one topic resolved concurrently create exactly one tag |
| Delete a tag in use | refused (the one behaviour change); article deletion still cascades; unused tags can still be deleted |
| Bad data (duplicate tags, empty tag name, duplicate subscribers) | each migration refuses with its message and leaves nothing behind |
| Supabase-style privileges (default privileges granting new tables to the API roles) | `anon`/`authenticated` read nothing and cannot write (RLS, no policies); `service_role` works; deleting an article cascades its sessions |
| Historical preflight file | reads correctly before and after on the fixture, returns no row contents |
| Historical rollback (scratch database only) | catalog returns to its pre-#117 state, data intact, migrations apply again afterwards |
| Rollback with data in a table | refuses unless forced, and removes nothing |
| **Rollback without acknowledgement (new)** | refuses to run at all, even on empty tables, even with tags present, and even with the force flag; removes nothing |
| **Verify script (new)** | read-only (also run inside a `READ ONLY` transaction); reports no `FAIL` on a fully remediated database; reports `FAIL` for each of: API-role table grant, API-role column grant, RLS off, extra policy, wrong FK rule, missing index; on the pre-#117 database it reports `FAIL`s rather than erroring; never returns row contents |
| SQL vs JavaScript tag identity over 25 labels | agree (one macOS-only label excluded locally; production-verified separately) |
| `article_comments` (separate) | applies, replays, matches the Prisma model, works through the real client, then drops |

**What the rehearsal cannot prove:** behaviour on Supabase's server itself (Postgres 17 on Linux; the rehearsal runs Postgres 16 on macOS), the SQL editor's own wrapping of scripts, statement timeouts, or any live application flow.
That is why the production-side read-only checks in section 4 and the outstanding smoke tests in section 5 exist.

## 10. Rollback: read this before considering it

**Do not run `historical/pr117-rollback-DO-NOT-RUN-IN-PRODUCTION.sql` against production.** Production now depends on every object it would drop. Running it would:

* break newsletter sign-up for every visitor and every article save that carries tags (the functions and unique indexes disappear);
* break image upload and make already-uploaded images untracked (the table that records them is dropped);
* break reading analytics and the two daily crons;
* silently turn `article_tags_tagId_fkey` back into `ON DELETE CASCADE`, so deleting a tag would strip it from every article;
* **destroy data** in the two dropped tables as soon as they hold rows (the script's row-count guard exists for exactly this, and is not a safety net for the whole script).

The script now refuses to run at all unless a session first sets `pr117.rollback_acknowledged` to a deliberately alarming phrase (written in the script). That guards against an accidental run; it does not make a run safe.
The whole script is a **single statement** (one `DO` block), so the guard and the drops stand or fall together whichever client executes it, including a client that sends statements one at a time and ignores errors (an earlier
`BEGIN ... COMMIT` layout was shown to be bypassable that way, and a test now pins the single-statement form).
Rolling the database back also does **not** undo the deployed code, so the application would hit the same failures as 2026-10-08.

If a migrated object misbehaves, in order of preference:

1. **Roll forward** with a new, reviewed, idempotent migration that fixes the specific problem.
2. Disable the affected feature in code and redeploy, leaving the data in place.
3. If data is damaged, **restore from the 2026-10-09 backup into a new Supabase project or branch** and compare, rather than restoring over production.
4. Only for a scratch or rehearsal database: the historical script, read in full first.

## 11. Precautions for future migrations (lessons from this incident)

1. **Migrations are not applied by a deploy.** Merging a PR to `main` deploys its code to production within minutes; a `supabase/migrations/*.sql` file in the same PR does nothing by itself. Apply the migration to production
   **before** merging code that requires it (additive first, then code, then any destructive step), or ship the code behind a flag that stays off until the migration is applied. The PR template or reviewer checklist should ask: "does this PR need a migration, and is it applied?"
2. **Back up first.** The Free plan has no automatic backups. Take and verify a backup with the maintained runbook (section 7) before any production schema change, and do not touch that backup afterwards.
3. **Rehearse on a disposable local database** built from a frozen baseline, with the real application code paths, before touching production. Keep migrations additive, idempotent, and wrapped in `BEGIN ... COMMIT`, with preflight checks that refuse on bad data.
4. **Check production read-only before and after**, with counts and names only. Use `pr117-verify-post-migration.sql` as the pattern; write a similar one for the next change.
5. **Be explicit about privileges.** New server-only tables should enable RLS, add no policies, and `REVOKE ALL ... FROM PUBLIC, anon, authenticated` explicitly rather than relying on default privileges (section 6). Do not retro-edit the applied migration files; do it in new migrations.
6. **Decide how the registry is kept** (apply through `apply_migration`, or by hand and record the versions afterwards) and say so in the PR, so tooling and people agree on what is applied. This incident left confirmed registry drift (section 8).
7. **Never re-run or "undo" an applied migration to test something.** Use a scratch database.
8. **A migration is not a smoke test.** After applying, exercise each affected feature in production deliberately (section 5), and record the result.
9. **Never run database tests against `.env.local`.** It points at production. Use a local server and set `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL` explicitly.

## 12. Risks that remain

| Risk | Likelihood and handling |
|---|---|
| The `IMMUTABLE` tag function depends on the server's C library (case mapping, `[:alnum:]`); if Supabase ever changes it, existing index entries could disagree with new computations | low, long-term. The parity test and the 25-label production re-check are the early warning; rebuild the index (`REINDEX INDEX tags_canonical_identity_key`) after a major platform upgrade |
| The API-role lock-down depends on default privileges and RLS rather than explicit revokes (section 6) | mitigated: RLS with no policies, verified; re-run the verify script after any platform or role change; add explicit revokes to future migrations |
| **Confirmed registry drift:** the registry records none of the five migrations applied on 2026-10-09 (section 8) | real but not urgent: the schema is correct. Documented; do not re-apply or roll back to "fix" it; repair is a separate, reviewed step |
| Features untested end to end in production (section 5) | open until the smoke tests are run |
| `article_engagement_sessions` is empty | unexplained but unsurprising shortly after the migration; check after real reads, together with the daily crons |

## 13. Where this fitted in the whole rollout (as planned on 2026-10-08; later steps not re-checked here)

Every merge to `main` is an automatic production deployment, including docs-only merges (the runtime code is then identical, so it is harmless, but it is still a deploy).

| Step | What | Status |
|---|---|---|
| R0 | Merge #121 (test-only) and this PR (docs, SQL and tests only) | planned; no runtime effect |
| R1 | Backup, apply the four migrations and `article_comments` | **done 2026-10-09**, state verified (section 4) |
| R2 | Merge #120 (publish-only secret, monitor) | not re-checked by this review |
| R3 | Scheduler Phase A (cron infrastructure migration, Vault secret, supervised invocation) | not re-checked |
| R4 | Scheduler Phase B (enable migration; retire the GitHub schedule) | not re-checked |
| R5 | A week later: remove the `schedule:` block from `publish-scheduled.yml` | not re-checked |

R1 had no dependency on the scheduler work and was done first because it repaired live, user-facing failures. Nothing in this PR changes runtime code, a migration, or production.
