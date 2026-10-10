# Release guide: admin overhaul

Branch `feat/admin-overhaul`. Nothing here has been pushed, merged, deployed or applied to production.

## 1. Order of operations

1. **Review** the diff and this branch's PR. Merge only with explicit approval.
2. **Staging first** (see `STAGING.md`): apply the three migrations to the *testing* database, deploy the branch to the testing project, run the
   checks in section 4, and use Testing Mode to walk Writer, Editor and Growth.
3. **Production database, before the code**, in this order, each reviewed and run by an operator (they are additive and idempotent):
   1. `supabase/migrations/20261010_debate_lifecycle.sql`
   2. `supabase/migrations/20261010_team_member_updated_at.sql`
   3. `supabase/migrations/20261011_hidden_debate_article_guard.sql` (needs 1; it also archives any article that is public inside a hidden debate, which
      on production today is none because hidden debates do not exist yet).
   Old code keeps working after each step: every new column is nullable or defaulted and unknown to old code. Take a database backup first.
4. **Deploy the code.** Immediately check `GET /api/admin/deployment-health` as an admin: 200 and no gaps.
5. **Leave Testing Mode off in production.** Do not set `TESTING_MODE_ENABLED` there. Optionally set `TESTING_WORKSPACE_URL` to the testing origin (a link only).

Never run step 4 before step 3: the new debate screens and `team_members.updatedAt` reads need the columns, and `deployment-health` will say exactly which are missing.

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
overview; Testing Mode checklist, scenarios and access check. Three additive migrations. No new environment variable.

## 4. Pre-release checks to run on staging

* `GET /api/admin/deployment-health` is 200 with no gaps.
* As admin: unpublish a debate, confirm its articles 404 publicly, then try to publish one article from the article editor: it is refused (409).
* Team Members: assign an unlinked profile to a test account; edit its position; reload; open **Our Team**.
* Testing page: *Check access* as Writer, Editor, Growth shows all Pass.
* Console clean on the dashboard, Team Members, Debates and Testing.

## 5. Remaining risks

* The hosted workspace is verified only through its schema and the gate logic, not by running this code there (see `STAGING.md`).
* Four local branches and the open drafts also touch `prisma/schema.prisma` (additive). Expect trivial rebase conflicts if they merge after this.
* Scenario fixtures are shared persona accounts, so "new account" is partial (stated in the UI). Reset is owner-scoped and idempotent; see `TESTING-MODE.md`.
* `latest-article` is still `s-maxage=60`: a hidden article can remain in that one JSON response for up to a minute at the CDN. The feed and sitemap are not cached.
* Scheduled publishing was verified on a local real Postgres, **not on hosted staging** (no scheduler runs there by design).
* `updatedAt` has millisecond resolution; two edits to one row within the same millisecond would not be detected as stale.

## 6. Production deployment plan (draft; nothing here has been run)

**Preconditions.** The PR is reviewed and approved; the branch has been merged with the then-current `origin/main` (this branch merged cleanly with
`438d596` in a conflict check) and the complete regression re-run on the merged tree; the staging deployment has been repeated at the final commit.

1. **Backup first, and prove it.** The staging hashes taken during verification are *not* a backup of production. Before step 2 an operator must:
   confirm in the Supabase dashboard (project `scllbuwkcqtmfogsgalt`) whether point-in-time recovery is enabled and note the restore window, **or**
   take a logical dump with the direct connection (`pg_dump --format=custom`, stored outside the repository), and restore it into a throw-away database to
   confirm it opens and row counts for `articles`, `debates`, `team_members`, `users`, `notifications` match. Record who did it and when. Do not proceed
   without one of these.
2. **Pre-flight read-only checks** (section 2 SQL plus: `select count(*) from articles where status in ('PUBLISHED','SCHEDULED') and "deletedAt" is null`
   and the same joined to `debates`; there must be no hidden debates yet, and nothing the guard would archive).
3. **Migrations, one at a time, in order, each verified before the next** (additive, idempotent, validated against a copy of the old schema; none are new
   since the staging run): `20261010_debate_lifecycle.sql`, `20261010_team_member_updated_at.sql`, `20261011_hidden_debate_article_guard.sql`.
   After each: the object exists, existing-row hashes are unchanged, the application still serves. Old code is compatible after every step.
4. **App rollout** after the third migration: deploy the merged commit through the normal pipeline. No new environment variable. Testing Mode
   stays off (do not set `TESTING_MODE_ENABLED`).
5. **Immediately after:** `GET /api/admin/deployment-health` as an admin (200, no gaps, includes `articles_hidden_debate_guard`); `/feed.xml` and
   `/sitemap.xml` return 200 with `max-age=0` and no positive `s-maxage`; home page, one article, `/opinion-debate`, `/team` (Editor-in-Chief first, once);
   the scheduler's next run succeeds (`publish-scheduled` workflow, response `200`).
6. **Functional smoke on production with a throw-away debate** created by an admin and removed again: unpublish (articles 404, feed/sitemap drop it), publish,
   delete, permanent delete with typed title. Use a clearly named test debate; do not touch real content.
7. **Rollback.** Code: redeploy the previous production build (the additive schema may stay). Schema only if required: `ROLLBACK` in
   `tests/integration/admin-overhaul-migrations.test.ts`. If data is damaged, restore from the step-1 backup, not from staging.
8. **Watch** for 24 hours: the audit log for `DEBATE_*` and `TEAM_CARD_*` actions, `[revalidateArticleLists] FAILED` and `HIDDEN_DEBATE_ARTICLE` in logs
   (the latter means someone tried to republish a hidden debate's article and was refused).
