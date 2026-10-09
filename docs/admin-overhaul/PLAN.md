# Admin overhaul: investigation and design

Branch `feat/admin-overhaul`, cut from `origin/main` (92eb04b). Nothing here is deployed, and no
migration has been applied to production. All database work runs against a throwaway local cluster.

## Findings (what exists, what is wrong)

**Testing Mode** is already a real design: dedicated persona accounts (`testPersonaKey`), a signed
15-minute `TestingSession`, an attested workspace marker row, fail-closed env checks
(`src/lib/testingMode.ts`). "Unavailable: Testing mode is disabled" is the *correct* result when
`TESTING_MODE_ENABLED=1` and a verified isolated workspace are not configured. It is not a bug and
must not be bypassed. What is wrong is that the page reports one opaque sentence, gives no setup
path, and sits in the same sidebar group as everyday admin tools.

**Debates** have `isActive` only. There is no unpublish, delete, restore or audit. Each debate owns
two published `isDebate` articles that stay publicly reachable (category pages, archive, search,
sitemap) regardless of the debate. `Debate -> Article` has no `onDelete`, so purging a trashed
debate article fails on the foreign key, and trashing one side by hand leaves a half-broken debate.
`/opinion-debate` lists every debate; `/api/debates/active` and the vote route only check `isActive`.

**Members / team** are split across three screens: `/editorial/members` (access role, invitations,
public position), `/admin/team` (public Meet the Team cards, including unlinked legacy cards) and
`/editorial/users` (reader accounts). The data model is already sound: `TeamMember.userId` is
`@unique`, `User.role` and `TeamMember.role/publicTier` are separate, self-service
`PUT /api/team-profile` rejects protected fields. Gaps: no way to assign an existing unlinked
card to an account except a raw `userId` field in the card form, no audit row for card edits or
links, `DELETE /api/team/:id` and `PUT` give 500 for a missing row, no stale-edit guard, and
no "needs a profile" view.

**Navigation**: two hand-maintained sidebars (`AdminSidebar`, `EditorialSidebar`) with divergent
groupings; Testing is under MANAGE next to Users and Members.

## Decisions

1. **Debate visibility** is derived from two new nullable timestamps (`unpublishedAt`, `deletedAt`)
   plus `deletedById`. `isActive` keeps its meaning ("the featured debate"). No new enum.
   Public means `deletedAt IS NULL AND unpublishedAt IS NULL`. "Archive" is the same state as
   unpublish: one concept, not two.
2. **Both articles follow the debate.** Unpublish/delete moves them to `ARCHIVED` (public queries
   already require `PUBLISHED`), publish/restore returns them to `PUBLISHED`. Permanent delete
   requires a soft-deleted debate and a typed-title confirmation, removes the debate and its
   votes (FK cascade) and moves the two articles to the existing article Trash, so the normal
   retention purge can then work, because nothing references them any more.
3. **One lifecycle module** (`src/lib/debateLifecycle.ts`), one route
   (`POST /api/editorial/debates/:id/lifecycle`), ADMIN only. Each transition is a guarded
   `updateMany` inside a transaction with its audit row, so a duplicate or concurrent request is a
   no-op/409 and a failure leaves nothing half-applied. Edit/create stay open to editors as today.
4. **Team Members** is the existing `/editorial/members` screen, renamed and extended rather than
   replaced; `/admin/team` card editing is folded in as a second view and its URL redirects.
   Account/profile linking goes through one function in `membership.ts` (audited, transactional,
   refuses a second card for an account and a second account for a card).
5. **Navigation** comes from one pure function (`src/lib/adminNav.ts`) used by both sidebars so the
   role matrix is unit-testable.
6. **Testing Mode** keeps its architecture. We add a setup-status checklist (which requirements
   are missing, never a secret), a documented setup path, deterministic scenarios (reset and
   repeat) and per-persona expectation checks for nav, routes and prompts.

## Stages and verification

| Stage | Output | Verified by |
|---|---|---|
| 2 Debates | migration, lifecycle lib/route, admin UI, public filters | unit + isolated-DB integration + browser |
| 3 Team Members | rename, link/unlink, profile admin, audit, reconciliation report | unit + DB integration + browser |
| 4 Navigation | shared nav config, dashboard overview | unit + browser |
| 5 Testing Mode | status checklist, scenarios, docs | unit + DB integration + browser |
| 6 Integration | full suites, build, regression | all of the above |
