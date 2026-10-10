# Hosted staging for Testing Mode: what exists, what is missing, how you will use it

> **Status update.** After this page was first written, `7202db9` was deployed to `consilium-testing` and migrations 1 to 3 were applied there
> (see `STAGING-VERIFICATION.md`, which also lists exactly what that run did and did not cover). Still outstanding for hosted staging: migration 4
> (`20261012100000_article_hidden_by_debate_marker.sql`) and a redeploy of the newer code. The facts below describe the state **before** that deployment
> and are kept as the baseline and checklist; `MIGRATION-PLAN.md` has the current per-environment migration state.

Facts below were checked **read-only** on 2026-10-11 (project listings, one schema query, one HTTP HEAD request).
Nothing was changed anywhere. Anything not listed as verified is labelled *unverified*.

## What already exists (verified read-only, 2026-10-11)

| Piece | State |
|---|---|
| Supabase `consilium-testing` (`zrieajoqosgzyesfatta`, eu-west-1) | Separate project from production (`scllbuwkcqtmfogsgalt`). Attestation row `testing-hosted-project` matches the reviewed project; marker `consilium-testing-zrieajoqosgzyesfatta`; **6 users, all `@consilium.test`; 0 subscribers**; 2 team cards; 37 articles; 0 debates. Schema accepts the three migrations (checked: enum has ARCHIVED/SCHEDULED, no triggers or name collisions on `articles`, unique `userId` index and debate FKs as expected, existing `consilium_testing` RLS policies). Application role: `consilium_testing`; the operator connection (`postgres`, not superuser) can apply DDL. |
| Vercel `consilium-testing` (`prj_zr8Of1h2eREC64esLiwFnpimtXno`, team `zanie567s-projects`) | **Exists** (an earlier version of this document wrongly said it was not visible; the MCP connector cannot see it but the CLI can). Git-linked to the private mirror `Zanie567/The-Consilium-Testing`, production branch `main`. Latest production deployment `dpl_BHnMFF7TUp7KfkkhfBnSm1LmAnXz`, uploaded from the CLI on 2026-10-09 16:16 BST, aliased to `https://consilium-testing.vercel.app`. |
| Its configuration | 16 variables, **production target only**. Plain values confirmed: `NEXT_PUBLIC_SUPABASE_URL=https://zrieajoqosgzyesfatta.supabase.co`, `NEXTAUTH_URL`/`NEXT_PUBLIC_SITE_URL`/`SITE_URL` = the testing origin, `EMAIL_TRANSPORT=capture-db`, `OUTBOUND_INTEGRATIONS_DISABLED=1`, `TESTING_MODE_ENABLED=1`, `TESTING_WORKSPACE_KIND=hosted`, `TESTING_WORKSPACE_ID=consilium-testing-zrieajoqosgzyesfatta`. `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET` and the service-role key are `sensitive` (unreadable by design); the hosted gate itself refuses to start unless the database URL is the reviewed pooler host, role and project ref. |
| Production project (`the-consilium`) | Its **production** target defines no `TESTING_*`, `OUTBOUND_*` or `EMAIL_TRANSPORT` variable, so Testing Mode cannot switch on there. Its only testing variables are Preview-scoped to the single branch `feat/public-appointments-testing-mode` and point at the testing Supabase, never at production data. |
| Mirror `main` | A different, older history (99 commits ahead of and 13 behind `origin/main`, last 2026-10-06). Pushing this branch to it would not be a fast-forward. |

### How to deploy this branch without pushing anything

Recent deployments to this project were uploads from the CLI, not git builds. The least invasive route is to export the **exact** commit
(`git archive 7202db9...`) into a clean temporary directory, link it to `prj_zr8Of1h2eREC64esLiwFnpimtXno`, and run
`vercel deploy --prod`. Nothing is pushed to GitHub; the project's own 16 variables are used; production is untouched. Rollback is to
promote the previous deployment (`dpl_BHnMFF7TUp7KfkkhfBnSm1LmAnXz`). Order matters: **migrations first, then deploy** (old code tolerates the
additive columns; new code needs them).

## What was not possible before the first hosted deployment (historical; see the status update above)

Writer/Editor/Growth testing **of this branch's changes** in a hosted environment cannot work until both of these happen:

1. The hosted app is redeployed from this branch (or a later commit that contains it).
2. The migrations are applied to the **testing** database (never production's), in order:
   `20261010_debate_lifecycle.sql`, `20261010_team_member_updated_at.sql`, `20261011_hidden_debate_article_guard.sql`,
   `20261012100000_article_hidden_by_debate_marker.sql` (the first three were applied on 2026-10-10; the fourth is pending approval).
   Until then `/api/admin/deployment-health` returns 503 with `Missing schema: ...` and the dashboard Deployment card says so.

Important gate detail: the hosted gate trusts exactly two site origins. (a) `https://consilium-testing.vercel.app`, any branch.
(b) A **Preview** of the *production* Vercel project, but only for branch `feat/public-appointments-testing-mode`
(`HOSTED_FEATURE_PREVIEW`). A Preview of `feat/admin-overhaul` on the production project is therefore **refused by design**.
So: deploy this branch to the `consilium-testing` project. Do not enable testing on the production project, and do not add
this branch's Preview to the allow-list unless you decide to, as a reviewed code change.

## Checklist to bring staging up (in order)

1. **Review and merge** (or point the mirror at) the branch you want staged. Production is untouched.
2. **Back up** the testing database (it holds fixtures only, but the habit costs nothing).
3. **Apply migrations 1, 2, 3** to `consilium-testing` only, through the normal operator connection. They are additive and
   idempotent; validated on a copy of the previous schema (`tests/integration/admin-overhaul-migrations.test.ts`).
4. **Environment variables** on the testing Vercel project (the existing 16, unchanged): `TESTING_MODE_ENABLED=1`,
   `TESTING_WORKSPACE_KIND=hosted`, `TESTING_WORKSPACE_ID=consilium-testing-zrieajoqosgzyesfatta`, the pooler `DATABASE_URL`/`DIRECT_URL`
   for role `consilium_testing.<ref>` with `sslmode=verify-full`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXTAUTH_URL`/`NEXT_PUBLIC_SITE_URL` = the testing origin, `EMAIL_TRANSPORT=capture-db`, `OUTBOUND_INTEGRATIONS_DISABLED=1`, and **no**
   Resend, Google, FRED or Alpha Vantage keys. No new variable is required by this branch.
5. **Deploy** that project from the branch. Then check `GET /api/admin/deployment-health` (signed in as the test admin): it must be 200
   with no gaps, including `articles_hidden_debate_guard`.
6. **Personas** already exist (`admin`, `writer`, `writer-other`, `editor`, `editor-global`, `growth` at `consilium.test`). The hosted seed is
   additive, so nothing needs re-creating. The fixture passwords are in your protected operator secrets file, not in this repository.
7. **External effects** are contained by design: email goes to the private `testing_email_outbox` table; OAuth, Resend and market-data
   integrations are blank; storage is the testing project's own buckets; the testing database has its own scheduler/cron (none runs
   against production). Never copy production keys into this project.

## How you will use it (once 1-5 are done)

1. Open `https://consilium-testing.vercel.app/admin/testing` and sign in as `admin@consilium.test` (password from your operator file).
   The page header reads **Isolated test workspace**; a banner reading **TEST ENVIRONMENT** stays on every page.
2. Optionally pick a persona under **Scenarios** and press **Apply** (e.g. *Member with unread notifications*). **Reset** undoes it.
3. Press **Test as Writer / Editor / Growth**. You land on that persona's real dashboard; the banner names the persona. The session lasts 15 minutes.
4. Walk the dashboard. Each scenario lists what must and must not appear. Press **Check access** to try administrator-only pages and APIs as the persona.
5. **Exit testing mode** returns you to the administrator view.

From the live site, `/admin/testing` will keep saying *unavailable* with a checklist. Set `TESTING_WORKSPACE_URL` on the **production**
project to `https://consilium-testing.vercel.app` to add a convenience link to it. That adds a link only; it enables nothing.

## What has been verified, and what has not

| | |
|---|---|
| **Verified** (isolated local stack, real server, real Postgres, Chromium + WebKit) | Persona sessions, expiry, switching, stale-form refusal, scenarios apply/reset/exact restore, prompts and notification counts per scenario, the access matrix for Writer, Editor and Growth, administrator-only API refusals, the unavailable screen and its checklist, the hosted-configuration *gate logic* (unit tests). |
| **Not verifiable until staging is configured** | That the hosted deployment actually runs this branch; that the hosted database accepts the migrations (they are validated on a faithful copy of the previous schema, not on that project); the hosted role's behaviour under its own RLS policies end to end (the guard function is `SECURITY DEFINER` specifically so it does not depend on them, and a restricted role was tested locally); real captured-email delivery through `capture-db`; Vercel build and environment wiring. |
