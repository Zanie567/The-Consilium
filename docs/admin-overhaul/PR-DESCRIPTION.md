# Admin overhaul: debate moderation, Team Members, navigation, Testing Mode, database safeguards

> Draft pull request description. Delete this file before merge if you prefer the text to live only in the PR.

Branch `feat/admin-overhaul`, based on `origin/main` `92eb04b` (a conflict check against `438d596` is clean). **Production is untouched.** Nothing in
this branch has been pushed, merged or applied to production; it has been deployed once, by CLI upload, to the separate `consilium-testing` project.

## What this changes

**Debate moderation.** Administrators can unpublish, delete (recoverable), restore and permanently delete a debate (typed-title confirmation; its articles go to
Trash). Every transition is a guarded, audited transaction. The two articles follow the debate, so a hidden debate disappears from the hub, article pages,
search, the feed and the sitemap at once. Creating and editing a debate is atomic.

**Team Members and profile linking.** One admin screen for accounts, roles and public profiles. One card per account (database-unique), assigning an
existing profile changes only its owner, stale edits are refused (`team_members.updatedAt`), and public title/placement are separate from the access role (a
role change can never alter the Editor-in-Chief card). New: *Replace with an existing profile* for the hidden placeholder a claim creates, as one atomic,
audited action that never discards a genuine profile.

**Navigation and dashboard.** One portal frame with a role-driven menu and an admin overview; Subscribers, Login Attempts, Data Management and Testing
live under it. The profile editor's "saved" message always describes the latest attempt; every field on the new-debate form is labelled and validated
accessibly.

**Testing Mode.** Real, isolated role testing (Writer, Editor, Growth) with 15-minute shared sessions, stale-form refusal, an access check, and scenarios
whose rows are owned by the persona they were applied to (reset never deletes another persona's data and is idempotent). It refuses to run anywhere that
is not a verified isolated workspace; it stays off in production (no new environment variable).

**Security and database protections.** A `SECURITY DEFINER` trigger (`articles_hidden_debate_guard`) makes it impossible, at the database, for an article of
an unpublished or deleted debate to become `PUBLISHED`/`SCHEDULED`, whatever route is used (editor, review, Trash restore, scheduler, raw SQL), with a
matching read-side exclusion for data that predates it. Feed and sitemap are uncacheable and rebuilt from a tagged data cache that is expired only after
the mutation commits.

## Migrations (three, additive, idempotent, applied in this order)

1. `20261010_debate_lifecycle.sql`: nullable `unpublishedAt`, `deletedAt`, `deletedById` on `debates`.
2. `20261010_team_member_updated_at.sql`: `team_members.updatedAt` (stale-edit token).
3. `20261011_hidden_debate_article_guard.sql`: the guard trigger (requires 1), and archives any article already public inside a hidden debate (none today).

No migration or schema change since the staging run. Old code works after each step.

## Automated testing (final commit, isolated launcher: fresh per-run database, fake storage, captured email, local build)

| | |
|---|---|
| TypeScript, ESLint | clean |
| Vitest, unit | 1162 / 1162 (111 files) |
| Vitest, all DB-backed suites on a real Postgres | 1802 passed, 45 skipped by design (destructive) |
| The 45 destructive tests, each on its own purpose-named disposable database | 45 / 45 (publish race 9, cron SQL 29, trash purge 7) |
| Playwright, all projects (Chromium, WebKit, mobile, testing-mode, upgrade, lifecycle) | see the final report for the exact counts of the final run |

Notable suites: `hidden-debate-guard-db` (21), `public-feed-visibility-db` (9), `team-placeholder-replace-db` (9), `testing-scenarios-db` (17),
`debate-lifecycle-db`, `admin-overhaul-migrations`, and browser specs `wf-feed-invalidation`, `wf-admin-debates`, `wf-admin-team-members`,
`wf-testing-scenarios`, `wf-admin-ui-audit`.

## Hosted staging (Supabase `consilium-testing`, Vercel `consilium-testing`; never production)

At `7202db9`: three migrations applied one at a time with unchanged data hashes; deployment READY; `/api/admin/deployment-health` healthy; debates, Team Members,
dashboard, Testing Mode personas, scenarios and email capture verified in a real browser. Findings and their fixes: `STAGING-VERIFICATION.md`. The fixes in this
PR since then have **not** been deployed to staging (awaiting approval).

## Release requirements

See `RELEASE.md` section 6: verified backup (staging hashes are not one), migrations 1 to 3 in order with verification between each, then the app, then
`/api/admin/deployment-health`, a feed/sitemap check and a throw-away-debate smoke test. Testing Mode stays off. Rollback: previous build; schema rollback only
if required.

## Known limitations

* Scenario fixtures are shared persona accounts: a scenario is a partial "new account" simulation; notifications from a tester's own actions that do not point
  at a scenario article are kept.
* `latest-article` keeps `s-maxage=60` (bounded staleness for one JSON endpoint). Feed and sitemap are not cached.
* Scheduled publishing is verified on a local real Postgres, not on hosted staging (no scheduler runs there).
* Stale-edit detection uses millisecond `updatedAt`.
* `GET /api/team` includes each card's contact email (pre-existing).
