# Testing The Consilium

Public appointment separation and simulator operations: [appointments-and-testing-mode.md](./appointments-and-testing-mode.md). Current acceptance/results: [acceptance-and-evidence.md](./acceptance-and-evidence.md).

## The suites

Start a separate disposable PostgreSQL cluster, then supply its administrative URL explicitly:

```sh
TEST_DATABASE_URL=postgresql://postgres@localhost:55445/postgres \
E2E_APP_PORT=3357 FAKE_STORAGE_PORT=55446 E2E_REQUIRE_CLEAN=1 npm run test:audit
```

Choose unused ports. The launcher creates and drops a unique `consilium_audit_<run>` database; it does not reseed or drop the administrative database in that URL. Never supply a production URL. `TEST_DB_ALLOW_HOST` permits only an exact explicitly approved disposable host; it does not waive per-run database ownership checks.

Environment generation fails before SQL, cleanup, build or services. Occupied ports, dirty trees when required, cached builds and existing servers are refused. The application attests its actual database, and fixture preparation, helper reads and cleanup verify the same owned database. Each run owns its build directory, private tsconfig, authentication-state directory, captured outbox and artifacts.

Storage points to the local Supabase-compatible stand-in; email is captured and never delivered; OAuth/provider keys are blank; market data is explicitly empty and scheduler secrets are throwaway. All values Next could otherwise obtain from `.env` files are explicitly overridden before building. Only run-owned processes and databases are cleaned up.

The routine GitHub Actions gate runs lint, typecheck, unit/route tests and a production build, then an isolated PostgreSQL-backed full audit on desktop Chromium, desktop Playwright WebKit, Pixel/iPhone layout emulations and Team Profile. Separate isolated public/mobile and critical role/profile/testing-mode jobs run on every PR alongside quality checks; desktop workflow projects automatically include every implemented audit screen. GitHub currently reports main as unprotected, so repository branch protection does not enforce these checks; no branch settings were changed. Browser retries are zero. Per-action/navigation deadlines remain 10/15 seconds. A 60-minute aggregate job budget covers installation, the build and three serialized phases (the measured local audit took about 30 minutes). It retains first-failure traces/screenshots and useful successful article evidence. Authentication storage state is outside artifact paths; captured reset-link email files are excluded from uploaded artifacts.

A browser action must assert the exact successful response code and reopen persisted state. API/database checks do not establish the corresponding UI action. Application console/page errors remain asserted; the inherited narrowly documented cancelled-localhost-RSC WebKit exception is retained and separately covered by unit tests. Mutations sharing commissioning, glossary or storage state run in separate serialized phases. Fixtures and cleanup are scoped to owned accounts/records.

The source census is regenerated with:

```sh
npx ts-node -P tsconfig.seed.json scripts/build-workflow-inventory.ts
```

It enumerates declarations, routes, native dialogs, conditional variants and dynamic families. It is inspection evidence, not action coverage. See [the action inventory](coverage-inventory.md) and [the report](workflow-audit-report.md) for executed results and gaps.

The same formatting/lifecycle/upload/role/control/failure specs also run through genuine personas in `simulator-chromium`; `testing-mode` checks parity, revocation and switching. Projects: `wf-chromium`, `wf-webkit` (desktop Safari engine), `wf-mobile-chromium` (Pixel 7),
`wf-mobile-webkit` (iPhone 14). The `team-profile` specs now run in every full run.

```sh
node scripts/diagnostics/webkit-cancellation.mjs test-results/webkit-cancellation.json
node scripts/diagnostics/share-popup.mjs
node scripts/diagnostics/related-card-stack.mjs
node scripts/diagnostics/session-cancellation.mjs
node scripts/diagnostics/next-navigation.mjs
node scripts/diagnostics/image-optimizer-abort.mjs --original --output=test-results/image-abort-before.json
node scripts/diagnostics/image-optimizer-abort.mjs --output=test-results/image-abort-after.json
```

The image probe restores the original pinned function only in its disposable child process. Installation applies the exact, version-checked upstream Next PR #98168 response-socket backport to both module distributions. Review/remove that backport before changing Next versions.

Local stand-ins do not prove staging storage policies, signed URLs, transformations, CDN behaviour, email delivery, OAuth, real Safari or physical-device behaviour. Those checks require separate controlled resources and remain explicitly reported.

Summarise one completed full run without merging results across revisions:

```sh
node scripts/summarize-workflow-run.mjs test-results/<run> docs/testing/verification-results.json <GitHub-run-URL>
```

GitHub PR jobs test the temporary merge commit. Record that exact hash from `commit.json`, the branch head, and their tree relationship explicitly. A report-only follow-up commit does not establish new application verification.
