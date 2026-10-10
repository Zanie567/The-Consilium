# Admin overhaul: debate moderation, Team Members, navigation, Testing Mode, database safeguards

> Draft pull request description. Delete this file before merge if you prefer the text to live only in the PR.

Branch `release/admin-overhaul`: a linear replay of the 24 overhaul commits on `origin/main` `438d596` (no merge commits), plus the migration 5 hardening and the
documentation commit. **Production is untouched.** Nothing has been pushed, merged or applied to production. The application tree (`src/`, `prisma/`, `public/`, all
other migrations and tests) is byte-identical to the tree that was deployed to the separate `consilium-testing` project at `0ec2897` (tree `d43f95d9`); the complete
branch differs from that tree by exactly three files: migration 5, its integration test and this description.

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
the mutation commits. Migration 5 removes `EXECUTE` on the two trigger functions from `PUBLIC`, `anon` and `authenticated` (least privilege; the advisor flags the
`SECURITY DEFINER` one). It is hygiene, not a demonstrated hole: a trigger function cannot be called directly, and those roles hold no write privilege on `articles` or
`debates`. Triggers keep firing because the privilege is checked at `CREATE TRIGGER`, not when a trigger fires (tested).

## Migrations (five, additive, idempotent, applied in this order; details and per-environment state in `MIGRATION-PLAN.md`)

1. `20261010_debate_lifecycle.sql`: nullable `unpublishedAt`, `deletedAt`, `deletedById` on `debates`.
2. `20261010_team_member_updated_at.sql`: `team_members.updatedAt` (stale-edit token).
3. `20261011_hidden_debate_article_guard.sql`: the guard trigger (requires 1), and archives any article already public inside a hidden debate (none today).
4. `20261012100000_article_hidden_by_debate_marker.sql`: nullable `articles.hiddenByDebateAt` plus a trigger that clears it whenever an editor changes an article's status or trash state. Debates set it when they archive an article and restore **only** articles that still carry it (no backfill).
5. `20261012110000_revoke_trigger_function_execute.sql`: privileges only (`REVOKE EXECUTE` on the two trigger functions from `PUBLIC`, `anon`, `authenticated`). Changes no table, row, trigger or function body. Rollback is the `GRANT` in its header.

Hosted staging: 1 to 4 are applied and recorded (`20261010122238`, `20261010122248`, `20261010122319`, `20261010170814`). **5 is not applied anywhere yet**; applying it to staging
needs a fresh go-ahead (see the release notes below). Nothing is applied to production. Old code works after each step. The Supabase CLI must not be used for
these files (duplicate `20261010` prefixes and a rollback script in the same directory; see `MIGRATION-PLAN.md`).

## Automated testing (final commit, isolated launcher: fresh per-run database, fake storage, captured email, local build)

| | |
|---|---|
| TypeScript, ESLint | clean (exit 0 each) |
| Vitest, whole suite incl. DB-backed suites against the live isolated stack, PostgreSQL 17.11 (measured on `0ec2897`; the default `npm test` run, which excludes the DB-backed suites, reports 1485) | 1923 passed, 0 failed, 66 skipped (157 files passed, 4 skipped) |
| The 66 skips, run separately, each on its own purpose-named disposable database | 66 / 66: publish race 9, trash purge 7, scheduler cron SQL 29, PR #117 migration rehearsal 21 |
| Playwright, all four phases (main 87, workflow 568, team-profile 49, upgrade 36) | 740 passed, 0 failed, 0 flaky, 0 skipped |

Notable suites: `hidden-debate-guard-db` (21), `public-feed-visibility-db` (9), `team-placeholder-replace-db` (9), `testing-scenarios-db` (17),
`debate-lifecycle-db`, `admin-overhaul-migrations`, and browser specs `wf-feed-invalidation`, `wf-admin-debates`, `wf-admin-team-members`,
`wf-testing-scenarios`, `wf-admin-ui-audit`.

## Hosted staging (Supabase `consilium-testing`, Vercel `consilium-testing`; never production)

Staging runs the exact application tree of this branch: deployment `dpl_DD8kY3HKinM1vaB17iaN5jZYDTd7` (READY, aliased to `consilium-testing.vercel.app`, uploaded from a clean
export of `0ec2897`, nothing pushed) over migrations 1 to 4. On 2026-10-10, as a temporary `@consilium.test` administrator (since deleted), these were run against it:

| Check | Result |
|---|---|
| `GET /api/admin/deployment-health` | 200 `{"healthy":true,"gaps":[]}` |
| Debate lifecycle (real API, dedicated fixtures) | create, archive one article independently, hide (stale request 409 `STALE`, duplicate 409), publish a hidden debate's article by `PUT` refused 409 `HIDDEN_DEBATE_ARTICLE` (both the live and the independently archived one), republish: only the article the hide archived returned (`articlesChanged:1`, `articlesNotRestored:1`); the independently archived one stayed archived. Database read-back matched; audit rows `DEBATE_CREATED/UNPUBLISHED/PUBLISHED`. |
| Marker trigger | `hiddenByDebateAt` set by the hide; cleared by an independent trash; the next republish restored nothing (`articlesChanged:0`, `articlesNotRestored:2`). |
| Feed and sitemap | Both answer `max-age=0, must-revalidate`, `x-vercel-cache: MISS`. For an ordinary article and for debate articles: present when public, absent immediately after trash, archive and debate hide, present again after restore or republish. |
| Team Members (real API) | sign-up listed; authorise creates a hidden placeholder; plain link onto an account that has a card refused (`ACCOUNT_HAS_CARD`); replace-placeholder refused when stale (`STALE`) and on replay, succeeded once with the genuine profile untouched except its owner and the placeholder gone; position edit, hide, restore persisted and followed the public `/team` page; role changes (WRITER to ADMIN to EDITOR) left the public title unchanged; stale edit refused; reorder touched only the fixture cards; the Editor-in-Chief card and the baseline cards were unchanged. Linking a card to an account with no team access was refused (`INELIGIBLE_ACCOUNT`), as designed. |
| Testing Mode (real UI) | Test as Writer, Editor, Growth: server identity is the persona, role-specific menu, banner, `/api/admin/*` 403 from every persona, Check access all Pass (14, 20, 12 probes). Scenarios applied through the UI; "Reset all personas" restored every persona's notification counts, article counts and profile-card hashes to the pre-test baseline, with no `[Scenario]` rows left. A scripted mutation without the page identity was refused 409 `TESTING_IDENTITY_CHANGED`; switching persona in one tab moves the others. As Editor the real review page published a scenario article through the confirmation dialog and it appeared in the feed. |
| Cleanup | All fixtures and the temporary administrator removed and verified (6 users, baseline cards); local credentials deleted. 48 audit rows that name the removed administrator are kept on purpose. |

**Not verified on hosted staging** (state it, do not assume it): the 15-minute session expiry itself, "Return to writer", the Growth and Writer in-persona workflows beyond
navigation and access checks, comment moderation, the two-administrator placeholder race (covered on a real local Postgres, 9 tests), the UI confirmation dialog for
placeholder replacement (the API contract was verified; the dialog is covered by `wf-admin-team-members.spec.ts` locally), scheduled publishing (staging has no scheduler),
and Vercel runtime logs (not reviewed). Observation: after a Testing Mode "Reset all personas" the feed kept a just-deleted `[Scenario]` article for roughly ten
minutes although the documented bound is the five-minute data-cache TTL; the sitemap was clean and ordinary content mutations expired immediately. Test-only path; worth a follow-up.
Findings from the first hosted round (`7202db9`) and their resolution are in `STAGING-VERIFICATION.md`.

## Release requirements

See `RELEASE.md` section 6: verified backup (staging hashes are not one), migrations 1 to 5 in order with verification between each (production's actual state must be read first; do not assume all five are missing), then the app, then
`/api/admin/deployment-health`, a feed/sitemap check and a throw-away-debate smoke test. Testing Mode stays off. Rollback: previous build; schema rollback only
if required.

## Known limitations

* Scenario fixtures are shared persona accounts: a scenario is a partial "new account" simulation; notifications from a tester's own actions that do not point
  at a scenario article are kept.
* `latest-article` keeps `s-maxage=60` (bounded staleness for one JSON endpoint). Feed and sitemap are not cached.
* Scheduled publishing is verified on a local real Postgres, not on hosted staging (no scheduler runs there).
* Stale-edit detection uses millisecond `updatedAt`.
* `GET /api/team` includes each card's contact email (pre-existing).
