# Public appointments and isolated testing

Implementation branch: `feat/public-appointments-testing-mode`. Production writes and deployment are outside this implementation run. The branch started with unrelated workflow-audit edits; those edits are preserved.

## Public appointment model

`User.role` grants website permissions. Authentication checks the real database account's activity and ban status; testing additionally requires verified email on both the initiating administrator and persona. `TeamMember.userId` is the unique ownership link. The card's admin-managed `role` (public title), optional `publicTier`, `order` and `isActive` govern public section, rank, prominence, ordering and visibility.

An explicit `publicTier` wins; otherwise the trusted title determines the tier. The existing hierarchy still renders one leading chief, with additional chiefs in leadership, and retains roster ordering. Ties use the stored card name rather than a self-edited account name. New ordinary cards receive an initial Writer/Editor/Growth appointment once. Subsequent permission changes preserve it. ADMIN never receives a card automatically, but an administrator owning an assigned card can use **Editorial → Team Profile** to edit description/photo. Public position is read-only there. Only admin team management can change title, placement, order, visibility or ownership.

The public page and public team API use the same filtered, explicit projection. Neither reads the effective testing identity. Inactive cards, banned/deactivated linked owners and duplicate legacy email cards remain hidden. Internal ownership fields are not exposed. Legacy adoption retains case-insensitive email matching, ambiguity checks and the database unique constraint. A self-service request cannot supply ownership or promotion fields. Admin linking preserves unspecified fields, including title, order, media and description.

Production was inspected **read-only** through the connected Supabase project `scllbuwkcqtmfogsgalt`. The verified card remains `cmnkzhmgr00050pits5oquv7g`, linked to `cmnnnylyo000004l7b74992hb` (Alexander Escala, alexanderescala@gmail.com), ADMIN, active, unbanned, **Editor-in-Chief**, order **1**. Photo and description are present. No account, card, article association or permission was changed. `team_members.userId` and the configured public avatars bucket already exist. The new columns/session table have not been deployed.

## Enter, switch and exit

The admin dashboard and sidebar have a **Testing** entry (`/admin/testing`). Production displays an unavailable explanation. An optional `TESTING_WORKSPACE_URL` contains only an independent origin; it adds a link, carries no credentials/session, and does not enable testing remotely. Sign in independently on that origin.

In the verified local workspace, sign in as `testing-admin@consilium.test` / `testing-local-1234`, open Testing and select **Test as Writer**, **Test as Editor** or **Test as Growth**. **Other Writer** and **Global Editor** exercise ownership and assignment boundaries. The persistent banner names the environment/persona and provides switching and **Exit testing mode**. The same article, review, profile and upload handlers serve ordinary and simulated logins.

The raw NextAuth identity stays the administrator. An opaque HttpOnly, SameSite=Strict capability points to a hashed, server-stored session lasting 15 minutes. The server checks the workspace, administrator's current eligibility, allowlisted persona's actual role/verification, owner, revision, revocation and expiry. Loss of eligibility permanently revokes an observed capability. Start/switch/exit require the exact Origin. Arbitrary IDs/roles are refused. No administrator override is passed to workflow authorization.

Sessions are **shared across tabs in one browser profile**. A switch/exit broadcasts refresh to the other tabs. Refresh and direct navigation resolve the server's current persona. History/focus checks prevent a restored document from retaining the old identity. Each mutation carries the identity that rendered its form; a stale identity returns **409 TESTING_IDENTITY_CHANGED**. Expiry restores real administrator navigation, and replay/modified cookies cannot recover the persona. Sign-out revokes active sessions, including when an account was just deleted. Switching navigates away from the current form; save work before switching. A request already authorized and in flight may finish under its captured actor; a later submission cannot act as the former persona.

AuditLog records real administrator ID, persona ID, session ID, start/switch/exit/sign-out/expiry/revocation, mutation path/method and handler outcome. It never records capability values, passwords, request bodies or uploaded bytes. Concurrency is serialized by the administrator row revision; only the last server transition leaves a usable capability.

## Local workspace and repeatable setup

Hosted interactive testing is **blocked**: no independently verified hosted database/storage/mail workspace was available. The gate deliberately accepts local services only. A production-backed preview cannot enable testing. Do not run destructive fixture tooling against hosted Supabase or production, including through an allowlisted hostname/proxy.

The final local review workspace was left running at **http://localhost:3342/admin/testing**, with database `consilium_appointments_dev_final` on localhost:55435, storage at `http://127.0.0.1:55425`, and captured mail at `/tmp/consilium-dev-final-outbox.jsonl`. Sign in with the fixture administrator above. The final readiness gate had no gaps and all four read-only smoke pages returned 200. This process is temporary; use the commands in the acceptance report to restart it, or the fresh setup below to create a separate workspace.

PostgreSQL 16, Node/npm dependencies and Playwright browsers are prerequisites. On macOS the default PostgreSQL binaries are `/opt/homebrew/opt/postgresql@16/bin`; Linux uses binaries on PATH. For a fresh local cluster:

```sh
PGPORT=55435 PGDATA=/tmp/consilium-appointments-pg PGSOCK=/tmp npm run test:setup-db
```

This provisions local `consilium`. Prefer a separate database per interactive/browser run:

```sh
createdb -h localhost -p 55435 -U postgres consilium_testing_workspace
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_testing_workspace USE_EXISTING_DB=1 npm run test:setup-db
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium_testing_workspace E2E_APP_PORT=3340 FAKE_STORAGE_PORT=55423 EMAIL_CAPTURE_FILE=/tmp/consilium-testing-mail.jsonl npm run testing:workspace
```

The launcher builds and starts the real app at `http://localhost:3340`, with its own build directory, database lease and storage process. Add `TEST_WORKSPACE_DEV=1` for `next dev`. Fresh isolated development runs disable persistent Turbopack filesystem caching to avoid the observed cache-flush stall; ordinary development keeps Next’s default. Ctrl+C stops the app/storage/lease. Storage is the local Supabase-compatible service at `http://127.0.0.1:55423`; it reads bucket configuration from this database and enforces size/MIME/duplicate rules. Its objects are ephemeral. At startup, only owned loopback avatar references of verified personas and the explicit @tp/@lifecycle fixture namespaces are cleared; their card IDs, links, titles, placement, description and order survive. Test emails append to the specified JSONL file; notifications persist in this database. Google OAuth and credentialed external integrations are blanked. Production receives no test writes, files, email, notification, analytics, leaderboard or index data because those resources are separate and the only enabled workspace is local.

Personas reuse the existing isolated fixtures: writer, a second writer, Opinion-assigned editor, editor without category assignments, and growth with exactly the existing GROWTH permissions. Existing fixture account passwords and appointments are preserved. `testing:seed` serializes concurrent seeds and refuses account-role/key conflicts or mismatched workspace markers in one transaction; conflicts leave no partial fixture changes. Ordinary writer login is `writer@theconsilium.com` / `writer2024`; seeded editor/growth credentials are documented in the existing test fixtures. These are local fixture credentials, never production credentials.

`TEST_DATABASE_URL` remains the source of truth. The database/base-URL safety policies are unchanged. Every launcher pins DATABASE_URL/DIRECT_URL, storage, auth/site origin, email, keys and cron values before Next can read `.env.local`. A cached build is not reused. A per-database advisory lease makes a competing setup/browser/interactive run fail before fixture mutations. Concurrent runs need separate databases, app/storage ports, email paths and result directories.

Each workflow removes only its generated article IDs/title prefix and initiating test administrators. Team fixtures use fixed owned fixture IDs/domains. No global roster deletion occurs. Optional abandoned-run cleanup requires a reviewed `E2E_CLEAN_RUN_PREFIX` and an article owned by a marked test persona; it is a no-op by default. Never use it for production resources.

## Identity/permission audit

| Path | Identity and safeguards |
|---|---|
| NextAuth session callback | Resolves real/effective identities centrally; the signed JWT remains the administrator |
| Direct `getServerSession`, verified helpers, layouts, dashboards, review/profile ownership | Receive the effective account, then use its actual database permissions/activity/ban state |
| Client `useSession`, navigation and forms | Use the same effective session; same-origin mutation fetches carry the page identity |
| Proxy | Verifies workspace on every enabled request, existing authentication/origin policy, mutation revision and server capability; no role trust from client |
| Article/review/comments/profile/admin APIs | Existing ownership/scope/validation handlers; testing audit records actual handler outcomes, including denied actions |
| Uploads | Existing byte sniffing, limits, bucket authorization and storage path; effective uploader ID determines ownership |
| Asynchronous notification/email work | Captured actor/record IDs from the authorized handler; local notification DB and capture transport |
| Scheduler/cron | Existing secret-authenticated publication job on local test DB; deterministic fixture due-time, no production job |
| Server Actions | No implemented mutation Server Actions were found; proxy also pins `next-action` mutations if added |
| Public masthead | Reads stored appointment and real linked account safeguards, never session/test identity |

## Published formatting

The owner explicitly confirmed **Keep the existing public house style**. Alignment, text colour and line spacing remain in persisted drafts and review previews; public rendering normalizes those presentation settings. Semantic formatting, tables, figures, captions and footnotes retain their existing rendering. The renderer and sanitizer are unchanged by this task; additional regression checks reject forged CSS/attributes.

## Migration, validation and rollback

1. Inspect the intended target read-only. Verify schema, avatar/article buckets and the original card/account identifiers. Do not blindly reapply `20261001_team_member_user_link`: it is already present on production.
2. Review and apply **only** `supabase/migrations/20261003231314_public_appointments_testing_sessions.sql` through the normal migration process. It adds `publicTier`, test persona/revision fields and the session table/indexes/RLS. It does not edit cards/users/appointments or seed personas. Keep simulator disabled on production.
3. With an explicitly selected operator connection, preview and save a reviewable plan:

```sh
DIRECT_URL="$OPERATOR_DATABASE_URL" npm run appointments:backfill -- --plan=/tmp/consilium-appointments-reviewed.json
```

The preview can run before the new column exists. It snapshots only previously implicit placements, preserves trusted titled appointments, and reports ambiguous records instead of guessing. The inspected production roster needs **one** change: the verified untitled Lucas Dwyer card `cmnmbpffj0000n3it54bk52vr` receives `publicTier=leadership` to preserve its historical position. Alexander and all other cards need no data update. This historical ID/name check exists only in the one-time backfill; no rendering exception remains. An unclassified ADMIN-owned card is reported for explicit review.

4. Review IDs/ownership/title/order and ambiguity output, then apply that exact plan:

```sh
DIRECT_URL="$OPERATOR_DATABASE_URL" npm run appointments:backfill -- --apply --plan=/tmp/consilium-appointments-reviewed.json
DIRECT_URL="$OPERATOR_DATABASE_URL" NEXT_PUBLIC_SUPABASE_URL="$OPERATOR_STORAGE_ORIGIN" SUPABASE_SERVICE_ROLE_KEY="$OPERATOR_STORAGE_KEY" npm run check:deployment
```

Changed snapshots abort before writes; conditional updates abort the transaction on a concurrent change. Reapplying an already-applied plan is a no-op. The migration's empty-schema and previous-schema upgrade tests preserve the original ID/owner/photo/bio/title/order and enforce unique ownership.

5. Deploy code only after the schema/storage gate passes. The launcher runs this gate before its build; `/api/admin/deployment-health` is a read-only authorized health endpoint returning **503** for gaps. The operator CLI requires storage endpoint/service credentials to be explicitly supplied in its environment, and the deployed endpoint reads its application configuration. Required ownership/placement/session fields, ownership uniqueness, session RLS, storage endpoint/credential presence, public `avatars`/`article-images` and avatar 5 MB/MIME configuration are checked. Admin team-photo upload now uses the configured avatars bucket through the normal endpoint; it no longer requests nonexistent/disallowed `team-photos`.
6. Run the read-only post-deploy smoke:

```sh
DIRECT_URL="$OPERATOR_DATABASE_URL" NEXT_PUBLIC_SUPABASE_URL="$OPERATOR_STORAGE_ORIGIN" SUPABASE_SERVICE_ROLE_KEY="$OPERATOR_STORAGE_KEY" SMOKE_BASE_URL=https://theconsilium.co.uk npm run check:deployment
```

It checks `/`, `/team`, `/api/team`, `/editorial/login` plus database/storage readiness. HTTP 200 alone is not sufficient. Independently confirm the original linked chief ID is the first masthead card, `lead` prominence, exactly once, and the self-service title says Editor-in-Chief. Missing columns/buckets produce a failing exit/status rather than an empty green report.

Rollback code through the deployment platform while retaining additive columns/table and the existing ownership link. Disable testing, revoke test sessions in the isolated workspace, and restore publicTier values only by reviewed IDs from the saved plan if undoing the backfill. Do not reset permissions, delete/recreate cards or drop ownership. Rolling back to the old role-derived renderer reintroduces the ADMIN masthead bug; use a corrected rollback build when possible. No production migration/backfill/deploy was executed here.

CI automatically runs the profile, testing-mode and ordinary/simulated role/workflow projects with local PostgreSQL, storage and captured mail. The separate verification job runs typecheck, unit tests and a default-disabled production build. Browser retries remain zero. See [acceptance-and-evidence.md](./acceptance-and-evidence.md) for commands, counts, artifacts and limitations.
