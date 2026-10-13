# Release guide: admin overhaul

Branch `release/admin-overhaul` (linear replay on `origin/main` `438d596`; the preserved sources are `feat/admin-overhaul` `39c96da`, `fix/admin-overhaul-prerelease` and the migration 5 proposal `d8549d6`). Nothing here has been pushed, merged, deployed to production or applied to production. **`MIGRATION-PLAN.md` is the authority for migration files, versions, order and per-environment state.**

## 1. Order of operations

1. **Review** the diff and this branch's PR. Merge only with explicit approval.
2. **Staging first** (see `STAGING.md`; migrations 1 to 5 and the application at `0ec2897` are already there): apply the outstanding migration to the *testing* database, deploy the branch to the testing project, run the
   checks in section 4, and use Testing Mode to walk Writer, Editor and Growth.
3. **Production database, before the code**, in this order, each reviewed and run by an operator (they are additive and idempotent):
   1. `supabase/migrations/20261010_debate_lifecycle.sql`
   2. `supabase/migrations/20261010_team_member_updated_at.sql`
   3. `supabase/migrations/20261011_hidden_debate_article_guard.sql` (needs 1; it also archives any article that is public inside a hidden debate, which
      on production today is none because hidden debates do not exist yet).
   4. `supabase/migrations/20261012100000_article_hidden_by_debate_marker.sql` (adds `articles.hiddenByDebateAt` and the trigger that clears it when an
      editor changes an article's status or trash state; no backfill).
   5. `supabase/migrations/20261012110000_revoke_trigger_function_execute.sql` (privileges only: removes `EXECUTE` on the two trigger functions from `PUBLIC`, `anon`,
      `authenticated`; hardening, not required by the code; rollback is the `GRANT` in its header).
   Read production's actual migration state first (`MIGRATION-PLAN.md` section 5); do not assume all five are missing. Old code keeps working after each step: every new column is nullable or defaulted and unknown to old code. Take a database backup first.
4. **Deploy the code, which here means merging the PR** (the production project is Git-linked and publishes on merge; see the gate in section 6, and do not merge before steps 1 to 3 are done, verified and the backup restore-tested). Immediately check `GET /api/admin/deployment-health` as an admin: 200 and no gaps.
5. **Leave Testing Mode off in production.** Do not set `TESTING_MODE_ENABLED` there. Optionally set `TESTING_WORKSPACE_URL` to the testing origin (a link only).

Never run step 4 (the merge) before step 3: the new debate screens and `team_members.updatedAt` reads need the columns, and `deployment-health` will say exactly which are missing.

### Rollback
Code: redeploy the previous build; the additive schema can stay. Schema (only if required): the statements are in
`tests/integration/admin-overhaul-migrations.test.ts` (`ROLLBACK`) and each migration's header. Dropping the debate columns discards only
unpublish/delete state, never debates, votes or articles; dropping `updatedAt` discards only the stale-edit token. The rollback was tested: it
restores the previous shape and leaves every existing row byte-identical, and the migrations then re-apply.

## 2. Verifying the Editor-in-Chief association on live data, without changing anything

Earlier notes say the card `cmnkzhmgr00050pits5oquv7g` is linked to account `cmnnnylyo000004l7b74992hb`. **Treat that as unverified until you run
these.** All are `SELECT`s; run them in the Supabase SQL editor for project `scllbuwkcqtmfogsgalt`, or through any read-only role. They write nothing.

```sql
-- A. The chief card, and who owns it. Expect: exactly one card titled Editor-in-Chief, userId = your account id,
--    account role ADMIN, active, not banned, card visible.
SELECT t.id, t.name, t.role AS public_title, t."publicTier", t."order", t."isActive" AS visible, t."userId",
       u.email, u.role AS account_role, u."isActive" AS account_active, u."isBanned"
FROM team_members t LEFT JOIN users u ON u.id = t."userId"
WHERE t.role ILIKE '%editor%in%chief%' OR t."publicTier" = 'editor_in_chief' ORDER BY t."order";

-- B. One card per account (must return zero rows; the unique index guarantees it, this proves it).
SELECT "userId", count(*) FROM team_members WHERE "userId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

-- C. Is the database constraint really there? Expect one UNIQUE index on ("userId").
SELECT indexdef FROM pg_indexes WHERE tablename = 'team_members' AND indexdef ILIKE '%unique%' AND indexdef ILIKE '%userId%';

-- D. Unlinked cards whose email matches an account (candidates for the Team Members "Assign" action). Review by eye.
SELECT t.id, t.name, t.email, u.id AS account_id, u.role FROM team_members t
JOIN users u ON lower(u.email) = lower(t.email) WHERE t."userId" IS NULL;

-- E. Admin accounts with no card (your own account should NOT appear here if you want to edit your own profile).
SELECT u.id, u.email FROM users u LEFT JOIN team_members t ON t."userId" = u.id WHERE u.role = 'ADMIN' AND t.id IS NULL;

-- F. Membership trail vs account role drift (expect zero rows).
SELECT m.email, m.role AS membership_role, u.role AS account_role FROM team_memberships m
JOIN users u ON u.id = m."userId" WHERE m.status = 'ACTIVE' AND m.role <> u.role;
```

After deployment the same questions are answered in the product, read-only: **Team Members → Data checks** lists unlinked cards that match
accounts, possible mis-links, duplicates and role drift, and the public **Our Team** page must show the Editor-in-Chief first, exactly once. The
public JSON (`GET /api/team`) is the other independent check.

Why a role change cannot disturb it (tested on a real database): the card's title and placement are card data. `setMemberRole` never writes them,
`PUT /api/team/:id` never writes the account role, and an administrator account without a card is never given a public title.

## 3. What this branch changes

Debates (unpublish/delete/restore/permanent delete, audit, atomic create/edit); feed and sitemap that follow every visibility change; "Replace with an existing profile" for generated placeholder cards; a database guard so a hidden debate's articles can never be public;
Team Members (assign/unassign/create profiles, one-owner rules, stale-edit refusal, data checks); one portal frame and role-driven menu with an admin
overview; Testing Mode checklist, scenarios and access check. Five additive migrations (see `MIGRATION-PLAN.md`). A debate remembers which of its articles it hid, so publishing it restores only those. Public series, topic, comment, reading-progress and view-count reads follow the same hidden-debate rule as every other public list. No new environment variable.

## 4. Pre-release checks to run on staging

* `GET /api/admin/deployment-health` is 200 with no gaps.
* As admin: unpublish a debate, confirm its articles 404 publicly, then try to publish one article from the article editor: it is refused (409).
* Team Members: assign an unlinked profile to a test account; edit its position; reload; open **Our Team**.
* Testing page: *Check access* as Writer, Editor, Growth shows all Pass.
* Console clean on the dashboard, Team Members, Debates and Testing.

## 5. Remaining risks

* The hosted workspace now runs this application tree (`dpl_DD8kY3HKinM1vaB17iaN5jZYDTd7`) and an administrator walked debates, feed and sitemap, Team Members and Testing Mode on it (`PR-DESCRIPTION.md`, "Hosted staging"). Session expiry, comment moderation and scheduled publishing were not exercised there.
* Migration 5 is applied on hosted staging and verified there by privileges and a rollback-only trigger test; the application was not redeployed or re-walked afterwards.
* Four local branches and the open drafts also touch `prisma/schema.prisma` (additive). Expect trivial rebase conflicts if they merge after this.
* Scenario fixtures are shared persona accounts, so "new account" is partial (stated in the UI). Reset is owner-scoped and idempotent; see `TESTING-MODE.md`.
* `latest-article` is still `s-maxage=60`: a hidden article can remain in that one JSON response for up to a minute at the CDN. The feed and sitemap are not cached.
* Scheduled publishing was verified on a local real Postgres, **not on hosted staging** (no scheduler runs there by design).
* `updatedAt` has millisecond resolution; two edits to one row within the same millisecond would not be detected as stale.

## 6. Production deployment plan and release checklist (nothing here has been run)

### GATE: merging PR #127 deploys it to production

The production Vercel project (`the-consilium`) is Git-linked to this repository with production branch `main`, `autoAssignCustomDomains=true`, no ignore-build step, no deploy hooks, and a plain `next build` with **no migration step**. **Merging PR #127 therefore builds and publishes immediately to `theconsilium.co.uk`** (current production deployment `dpl_GdRV9KxkNBhSmE3dtSQFTBo7fie3`, `main@438d596`). The new code reads `articles.hiddenByDebateAt` on every article query, so on an unmigrated database article pages break site-wide.

> **Do not merge PR #127 until (a) the required production migrations have been applied and verified, (b) the production backup/recovery procedure has been proven by an actual restore test, and (c) migration backward-compatibility with the CURRENTLY DEPLOYED application (`main@438d596`) has been checked for the interval before the merge.**

Each step below needs its own explicit approval from the owner. Steps marked **[IRREVERSIBLE]** cannot be undone by redeploying.

**Preconditions.** PR reviewed and approved; branch merged with the then-current `origin/main` (clean at `438d596`) and the regression suite re-run on the merged tree; staging verified at the final application tree (hosted vote test, `STAGING-VERIFICATION.md`).

### Checklist

1. **Identity and migration state (read-only).** Confirm the project ref is `scllbuwkcqtmfogsgalt` (and *not* `zrieajoqosgzyesfatta`), then run the `MIGRATION-PLAN.md` section 5 queries plus section 2 here and
   `select count(*) from articles where status in ('PUBLISHED','SCHEDULED') and "deletedAt" is null`. Record which of the five migrations are present. Do not assume all five are missing: production's registry has known drift (`docs/remediation/pr117-database-migrations.md`). There must be no hidden debates (the lifecycle columns do not yet exist).
2. **Backup and a proven recovery path.** Confirm PITR is enabled and note the restore window, **or** take `pg_dump --format=custom` with the direct connection (stored outside the repository). Either way, restore into a throw-away database and compare row counts for `articles`, `debates`, `debate_votes`, `team_members`, `users`, `notifications`. Record who did it and when. Staging hashes are not a backup. Do not continue without this.
3. **Compatibility with the deployed code (`main@438d596`), checked before any migration.** All five are additive and idempotent: old code ignores the new nullable `debates` columns and `articles.hiddenByDebateAt`; `team_members.updatedAt` has a default (`CURRENT_TIMESTAMP`) so old inserts still work; the guard trigger only refuses publishing articles of *hidden* debates and production has none; the marker trigger only writes `hiddenByDebateAt`; migration 5 changes privileges only. The old code must keep working after **each** step: after each migration load the home page, one article, `/opinion-debate`, and an editorial save. `tests/integration/admin-overhaul-migrations.test.ts` validates this against the previous schema.
4. **Temporary controls.** Freeze merges to `main` (and the open scheduler PR #120) for the window; announce the window; name who is on call and who can run the rollback. Optional, **separate decision that needs the owner's approval and is not to be done now**: temporarily disabling `autoAssignCustomDomains` so that a merge builds but does not take the domain until promoted.
5. **Apply only the missing migrations, one file at a time, in order** through the Supabase SQL editor (manual, audited; never `supabase db push` or any unrestricted CLI run, see `MIGRATION-PLAN.md` section 4): 1 `20261010_debate_lifecycle.sql`, 2 `20261010_team_member_updated_at.sql`, 3 `20261011_hidden_debate_article_guard.sql`, 4 `20261012100000_article_hidden_by_debate_marker.sql`, 5 `20261012110000_revoke_trigger_function_execute.sql`. **[IRREVERSIBLE in effect]** Rollback SQL exists but the guard trigger starts refusing publication of hidden-debate articles at once. Possible disruption: brief locks on `articles` (triggers, column) and `debates` (columns, index). Verify between each file (step 6) and re-run step 3's smoke checks.
6. **Verify schema and permissions.** `debates` has `unpublishedAt`, `deletedAt`, `deletedById`; `team_members.updatedAt` is `NOT NULL` default `CURRENT_TIMESTAMP`; `articles.hiddenByDebateAt` exists (nullable, 0 marked rows); both triggers `articles_hidden_debate_guard` and `articles_clear_hidden_by_debate` have `tgenabled='O'`; both functions are `SECURITY DEFINER` with `search_path = public, pg_temp`; `proacl` lists only `postgres` and `service_role`; row counts and hashes of `articles`, `debates`, `team_members`, `users` equal the step-1/2 values.
7. **Confirm the app is safe to deploy.** Run the SQL equivalent of `deployment-health` (all columns and triggers above present). Only now is it safe to merge. Re-check that `main` is still `438d596` or that any newer commit was reviewed.
8. **Merge the approved PR. [IRREVERSIBLE]** Vercel builds automatically and, because of `autoAssignCustomDomains=true`, assigns the production domain when the build is READY. Watch the build to READY. No new environment variable is needed.
9. **Verify the live app and monitor.** As an admin, `GET /api/admin/deployment-health` returns 200 and `"gaps": []`; open the admin routes (dashboard, debates, Team Members); `/feed.xml` and `/sitemap.xml` return 200 with `max-age=0` and no positive `s-maxage`; home page, one article, `/team` (Editor-in-Chief first, once); `/opinion-debate` (HTML and with header `RSC: 1`) and `/api/debates/active` must not leak a debate whose argument was archived or trashed (title, excerpt, author). **Testing Mode must be OFF**: its environment variables exist only on the Preview target; confirm none are present on Production. Run the throw-away-debate smoke test (create, unpublish, publish, delete, permanent delete with typed title) with a clearly named test debate. For 24 hours watch the audit log for `DEBATE_*` and `TEAM_CARD_*` actions, the logs for `[revalidateArticleLists] FAILED`, `HIDDEN_DEBATE_ARTICLE` (someone tried to republish a hidden debate's article) and any `40P01` / `P2034` (see "Known limitations" in `PR-DESCRIPTION.md`), and the next `publish-scheduled` run.
10. **Rollback.** Application: promote/roll back to `dpl_GdRV9KxkNBhSmE3dtSQFTBo7fie3`; the additive schema may stay (old code is compatible with it). Schema only if required: the `ROLLBACK` SQL in `tests/integration/admin-overhaul-migrations.test.ts`, in reverse order (also in `MIGRATION-PLAN.md` section 6). If data is damaged, restore from the backup proven in step 2, never from staging.
