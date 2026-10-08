# Remediation plan: the unapplied database changes behind PR #117

**Status: a plan only. Nothing here has been applied to production.** Everything below was checked read-only
against production on 2026-10-08, and rehearsed on an isolated local database.

## 1. Why this matters now

Production serves the code from PR #117 (`ec2a4d5`), but **none of #117's four database migrations were applied**.
The code and the database disagree, and four features are affected. Nothing has been reported yet because
nobody has hit them (Vercel's runtime-error log is empty since the deploy), not because they work.

| Feature (production, today) | What happens | Why |
|---|---|---|
| Newsletter sign-up (`POST /api/subscribe`) | **fails for every visitor** (HTTP 500) | calls `public.consilium_subscriber_identity()`, which does not exist |
| Saving an article that has tags (`POST /api/articles`, `PUT /api/articles/[id]`) | **fails for editors** | calls `public.consilium_tag_identity()`, which does not exist |
| Uploading an article image (`POST /api/upload`, bucket `article-images`) | **fails for editors** (HTTP 500, no orphan file is left in Storage) | writes a row to `article_image_assets`, which does not exist |
| Reading-time analytics collection | **errors** | `article_engagement_sessions` does not exist |
| Two new daily Vercel crons | return a fixed 503 each day | same two tables |

Not affected: scheduled publishing, public article pages, sign-in, comments on articles, and the trash purge. The purge only touches
`article_image_assets` for an article that references a *managed* image, and none can exist yet because uploads fail; if one did, that article's
deletion transaction would roll back, so the purge fails closed and never deletes wrongly.

A **fifth, older, separate gap** was found by the same check: `article_comments` (inline editorial comments, PR #97) does not exist in
production either. Its migration (`supabase/migrations/add_article_comments.sql`) says "run BEFORE deploying" and was never run. The review panel and the
editor load comments whenever an article is opened, so that feature has presumably been erroring since it shipped. It is included below as an
optional, clearly separated step.

## 2. Is this the complete list? (three independent checks)

1. **Schema diff.** `git diff 31a2053..ec2a4d5 -- prisma/schema.prisma` changes exactly: two new models (`ArticleImageAsset`, `ArticleEngagementSession`), `ArticleTag.tag` to
   `onDelete: Restrict`, and one new index. No column was added to any existing table.
2. **Column drift against production.** All 305 columns of all 40 models in the deployed Prisma schema were compared with production's `information_schema` (read-only; only names returned).
   The only things missing: `article_image_assets`, `article_engagement_sessions` (both from #117) and `article_comments` (older, separate). Every other column exists.
3. **Prisma's own structural diff** of a database built from the pre-#117 schema plus these migrations against the deployed schema shows no missing column, type, nullability, uniqueness or default.
   The only remaining differences are cosmetic: two hand-written foreign keys lack `ON UPDATE CASCADE` (ids are never updated), and `article_comments` has differently named indexes.

What was **not** compared: index/constraint definitions of the ~35 tables not touched here, and column *types* in production (names only). Neither is touched by these migrations.

## 3. What each migration does

| # | File | Adds | Existing rows touched | Locks | Refuses when |
|---|---|---|---|---|---|
| 1 | `20261006153514_discovery_topic_identity` | function `consilium_tag_identity`; unique index on it over `tags`; index on `article_tags("tagId","articleId")`; replaces FK `article_tags_tagId_fkey` (`CASCADE` to `RESTRICT`) | none | brief `SHARE` on `tags` (index build); brief `ACCESS EXCLUSIVE` on `article_tags` while the FK is dropped and re-added (it re-validates existing rows: 0) | an empty canonical tag name, or two tags with the same canonical name |
| 2 | `20261006160355_managed_article_images` | table `article_image_assets` (+2 indexes, RLS on, no policies) | none | none (new table) | never |
| 3 | `20261006161413_normalized_subscriber_email` | function `consilium_subscriber_identity`; unique index on it over `subscribers` | none | brief `SHARE` on `subscribers` (a concurrent sign-up waits milliseconds) | two subscribers whose canonical email is equal |
| 4 | `20261006161505_article_active_engagement` | table `article_engagement_sessions` (+3 indexes, check constraint, RLS on, FK to `articles` with `CASCADE`) | none | none (new table) | never |

Each file runs inside its own `BEGIN ... COMMIT`, so a failure leaves nothing behind (tested). Every file is safe to run again.

**The one behaviour change:** deleting a tag that still has articles attached is now refused. No code deletes tags (verified by search), and `tags` has 0 rows, so nothing depends on the old cascade.

**Dependencies.** The four are independent of each other and of the scheduler work (PR #120 reads only `articles` and `audit_logs`). Applying them in file order is recommended and is what the rehearsal does.
**Compatibility both ways:** the deployed code already requires them; the previous production code (`31a2053`) does not use them and tolerates them (they are additive), so applying is safe even if you later roll the code back.

## 4. Production data, and why the preflights will pass

Measured read-only on 2026-10-08 (counts only; no row contents were read):

| Fact | Value | Consequence |
|---|---|---|
| `tags` rows / `article_tags` rows | 0 / 0 | migration 1's duplicate and empty-name checks pass vacuously; the FK change affects no row |
| `subscribers` rows | 3 | |
| subscriber canonical-duplicate groups / non-canonical stored emails / blank emails | 0 / 0 / 0 | migration 3's check passes and its unique index builds |
| `articles` rows (live) | 21 (18) | migration 4's FK references an existing unique key |
| existing `article_tags_tagId_fkey` | present, `ON DELETE CASCADE` | the migration replaces it by name (no duplicate FK) |
| any of the 7 new indexes already present | none | no name collisions |
| Postgres / encoding / collation | 17.6 / UTF8 / `en_US.UTF-8` | `normalize()` needs Postgres 13+ and UTF8: satisfied |
| database size | 15 MB | a full backup takes seconds |

`docs/remediation/pr117-preflight.sql` re-checks all of this (SELECT only; counts and names, never contents). **Re-run it immediately before applying**: if anything changed it says so, and the
migrations also refuse on bad data themselves.

**Tag identity parity on the real server.** The tag-identity function's exact expression was run inline on production (read-only) over 25 labels, and the JavaScript `canonicalTagSlug` was
checked to equal those answers (`tests/unit/tag-identity-production-parity.test.ts`, 25/25). This matters because the unique index enforces the SQL value while the application computes the JavaScript value; a
disagreement would make saves fail or duplicates slip through. A developer laptop (macOS) disagrees with production on one Greek label, which is why the production server's own answers are the reference.

## 5. Backup (Free plan: you must take it)

Supabase takes **no automatic backups on the Free plan** (its docs recommend regular exports with `supabase db dump`). So a manual backup is a prerequisite, and it is cheap (15 MB).

Needs: Docker running, the Supabase CLI, and the project's connection string (Dashboard > Connect, direct or session pooler). **Never paste the connection string into chat, a ticket or a file in the repo.**

```bash
mkdir -p ~/consilium-backup-2026-10-08 && cd ~/consilium-backup-2026-10-08
read -rs DB_URL                      # paste the connection string, press Enter; nothing is echoed
supabase db dump --db-url "$DB_URL" -f schema.sql
supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only
unset DB_URL
ls -l schema.sql data.sql            # both non-empty
grep -c '^COPY public.subscribers' data.sql   # expect 1
```

Note: Docker and the Supabase CLI are **not installed on the machine this plan was prepared on**, and its `pg_dump` is version 16 (the server is 17, which `pg_dump` refuses), so the backup has to be taken
from a machine that has them. A lighter fallback for these specific migrations, which modify no existing row: Dashboard > Table Editor > export CSV for `subscribers`, `tags`, `article_tags` (3, 0 and 0 rows),
plus saving the output of the preflight file. That is sufficient to reconstruct everything the migrations could touch, but it is a weaker backup than the dump, so prefer the dump.

## 6. Rehearsal (isolated, nothing touched production)

`tests/integration/pr117-migrations-rehearsal.test.ts` (opt-in: `RUN_MIGRATION_REHEARSAL=1`, local server only) builds a database from `tests/fixtures/pre-pr117-schema.sql`, the exact pre-#117 DDL
(generated from the Prisma schema at `31a2053`, minus `article_comments`, mirroring production), seeds production-shaped data (3 subscribers, 21 articles, no tags), and runs the real application code.
Result on 2026-10-08: **13 of 13 pass**.

| Scenario | Result |
|---|---|
| BEFORE: the real subscribe route and the real tag resolver against the pre-#117 database | reproduces production today: sign-up returns 500, tag resolution throws "function does not exist" |
| Apply the four in order | no error; **3, 1, 1, 1 ms**; adds exactly 2 functions, 2 tables, 11 indexes; FK becomes `RESTRICT` (one constraint, replaced not duplicated); no existing row changed |
| Replay twice more | no error, catalog identical |
| AFTER: every table and column the deployed Prisma schema expects exists | yes (apart from the separate `article_comments`) |
| AFTER: real code paths | sign-up returns 201, a case/space variant is "Already subscribed", the database itself rejects a twin; five spellings of one topic, resolved concurrently, create exactly one tag |
| Delete a tag in use | refused (the one behaviour change); article deletion still cascades; unused tags can still be deleted |
| Bad data (duplicate tags, empty tag name, duplicate subscribers) | each migration refuses with its message and **leaves nothing behind** (function and index absent, rows intact) |
| Supabase-style privileges (`anon`, `authenticated`, `service_role`, default privileges granting new tables to them) | `anon` and `authenticated` read nothing and cannot write (RLS, no policies); `service_role` works; deleting an article cascades its sessions |
| Preflight file | reads correctly before and after, returns no row contents |
| Rollback | catalog returns to its pre-#117 state, FK back to `CASCADE`, data intact, and the migrations apply again afterwards |
| Rollback with data in a table | **refuses** unless forced, and removes nothing |
| SQL vs JavaScript tag identity over 25 labels | agree (one macOS-only label excluded locally; production-verified separately) |
| `article_comments` (separate) | applies, replays, matches the Prisma model, works through the real client, then drops |

**What the rehearsal cannot prove:** behaviour on Supabase's server itself (Postgres 17 on Linux; the rehearsal ran Postgres 16 on macOS), the SQL editor's own wrapping of scripts, and statement
timeouts. The data volumes make the last one irrelevant (milliseconds), and the first is why the production-side read-only parity check was done.

## 7. Production procedure (needs your explicit go-ahead; nothing here has been run)

Total time: a few minutes. **No downtime and no editor freeze are needed**: the locks are held for milliseconds on tiny tables.

1. **Backup** (section 5). Confirm the files are non-empty.
2. **Preflight.** Run `docs/remediation/pr117-preflight.sql` in the SQL editor. Expect: every object `absent`; the data checks all `0`; foreign keys `article_tags_tagId_fkey:c`; no unexpected existing index. Stop and read section 8 if not.
3. **Apply**, one file at a time, in this order, each as a single run in the Supabase SQL editor (paste the whole file; each has its own `BEGIN`/`COMMIT`). Stop at the first error; a failed file leaves nothing behind.
   1. `20261006153514_discovery_topic_identity.sql`
   2. `20261006160355_managed_article_images.sql`
   3. `20261006161413_normalized_subscriber_email.sql`
   4. `20261006161505_article_active_engagement.sql`
   They are applied by hand, like every other migration in this repository (it keeps no migration history). Applying them through the Supabase `apply_migration` tool would also work but would add registry entries with timestamps that do not match the file names, so the SQL editor is recommended.
4. **Optional, separate decision:** `supabase/migrations/add_article_comments.sql` (then nothing else; it already includes `quoted_text`). It enables the inline editorial comments.
5. **Verify.** Re-run the preflight: every object now `present`, FK `article_tags_tagId_fkey:r`, and the "unexpected existing index" list now shows the 8 new indexes (that is how a re-run is recognised, not an error). Then, read-only:
   ```sql
   select public.consilium_subscriber_identity('  Reader@Example.Test ') as sub, public.consilium_tag_identity('Investment & Finance') as tag;
   -- expect: reader@example.test | investment-finance
   ```
6. **Watch.** Check Vercel runtime errors for the next hour (expect none). The two Vercel crons run at 03:00 and 04:00 UTC and should now return 200; the first run is a no-op (the new tables are empty).
7. **Optional supervised smoke tests**, each a real production write, so decide knowingly: a newsletter sign-up with an address you own (adds a subscriber you can delete); saving a draft with a tag (adds a tag row; tags cannot be deleted while attached); uploading one image (adds a Storage object and a row).

## 8. Stop conditions

Stop and do not continue if: the preflight shows a non-zero data check (there is now a canonical duplicate to reconcile by hand; the migration would refuse anyway and change nothing); any migration errors (nothing is left behind; read the message); the backup is missing or empty; or Vercel starts reporting new errors after a step.

## 9. Rollback

`docs/remediation/pr117-rollback.sql` removes everything the four migrations added, in reverse order, and restores the FK to `CASCADE`. It is tested (catalog identical to the pre-#117 state afterwards; the migrations apply again).
It **refuses to run if either new table holds rows** (they would be lost), unless you first run `select set_config('pr117.rollback_force', 'yes', false);`.

**It does not undo the code.** Rolling the database back while `ec2a4d5` is deployed returns production to exactly today's broken state for sign-ups, tagged saves and image uploads. Roll back the database only if a migration itself misbehaves; otherwise
prefer rolling forward. To undo #117 completely, redeploy the previous production deployment (`31a2053`) as well. `article_comments` rolls back with `DROP TABLE article_comments` (empty on first apply).

## 10. Risks that remain

| Risk | Likelihood and handling |
|---|---|
| Data changes between preflight and apply (a new duplicate subscriber, say) | very low (3 subscribers); the migrations re-check inside their own transaction and refuse |
| The `IMMUTABLE` tag function depends on the server's C library (case mapping, `[:alnum:]`); if Supabase ever changes it, existing index entries could disagree with new computations | low, long-term. The production parity test is the early warning; rebuild the index (`REINDEX INDEX tags_canonical_identity_key`) after a major platform upgrade |
| The new tables are granted to `anon`/`authenticated`/`service_role` by Supabase's default privileges; only RLS (on, no policies) keeps them closed | by design here and tested; the scheduler migration additionally revokes explicitly. Consider the same for these two tables later |
| Rehearsal ran on Postgres 16 / macOS, production is 17 / Linux | the parts that could differ (case mapping) were checked on production directly; the rest is portable SQL |

## 11. Where this fits in the whole rollout

Three workstreams are in flight; their order matters. **Every merge to `main` is an automatic production deployment**, including docs-only merges (the runtime code is then identical, so it is harmless, but it is still a deploy).

| Step | What | Needs your approval | Depends on | Effect |
|---|---|---|---|---|
| R0 | Merge #121 (test-only) and this PR (docs and tests only), once their checks pass | yes (merge) | nothing | none at runtime |
| **R1** | **This plan:** backup, preflight, apply the four migrations (optionally `article_comments`) | **yes** | R0 not required | **restores sign-ups, tagged saves, image uploads, analytics; stops the daily cron errors** |
| R2 | Merge #120 (publish-only secret, monitor) after its CI | yes (merge) | nothing in the database; do R1 first so nothing else is broken when the new monitor starts | production deploy; **the hourly health workflow starts automatically**; GitHub keeps publishing |
| R3 | Scheduler Phase A: apply the cron infrastructure migration, create `publish_cron_secret` in Vault and `PUBLISH_CRON_SECRET` in Vercel, redeploy, one supervised guarded invocation | yes | R2 deployed (the route must accept the new secret) | Supabase can call the endpoint; nothing is scheduled |
| R4 | Scheduler Phase B: apply the enable migration, watch 3 clean runs, then `gh workflow disable publish-scheduled.yml` | yes | R3 | Supabase becomes the publisher |
| R5 | A week later: a PR removing the `schedule:` block from `publish-scheduled.yml` | yes (merge) | R4 stable | permanent retirement of the GitHub schedule |

Why R1 first: it repairs live, user-facing failures and has no dependency on the scheduler work. Keeping it in its own window also keeps database changes and code deployments from overlapping, so any problem has one obvious cause.
Why R2 after R1: the health check reads only `articles` and `audit_logs`, so it works either way, but it is cleaner to start a new monitor on a healthy system.
`article_comments` is independent of everything else and can be applied with R1 or left out.

## 12. Decisions for you

1. Approve the procedure in section 7 (and say when).
2. Include `article_comments` (step 4) in the same window, or leave it? It restores a feature that appears never to have worked in production.
3. Backup route: full `supabase db dump` (needs Docker and the CLI on your machine), or the CSV fallback for the three small tables.
4. Whether to run the optional smoke tests, and with which test address.
