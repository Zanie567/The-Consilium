# Testing The Consilium

## The suites

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Vitest: unit tests and in-process route-handler tests | test database for the DB suites |
| `npm run test:e2e` | Playwright, through `scripts/run-e2e.sh` (the only supported way) | `npm run test:setup-db` once |
| `npm run test:audit` | Vitest incl. the live-server API audit, then Playwright | as above |

`npm run test:setup-db` starts a throwaway local Postgres on port 5433, pushes the schema and seeds it. Start it before `test:audit`; that command reseeds the same resolved database unless `SKIP_DB_SETUP=1`. Use fresh ports and `PGDATA` for concurrent checkouts.

## Isolation: tests never touch production

`next build` and `next start` read `.env.local`, which holds the **production** database,
storage, email and OAuth keys, for every variable the process did not set itself. So the
test stack defines every one of them explicitly (`scripts/lib/testServices.ts`):

| Service | In tests |
|---|---|
| Database | `TEST_DATABASE_URL` or the local default; host checked by `assertSafeTestDatabaseHost` |
| Object storage | a local Supabase-Storage-compatible server (`tests/e2e/helpers/fake-storage-server.ts`); the app is **built** against it because Next inlines `NEXT_PUBLIC_*` |
| Email | `EMAIL_TRANSPORT=capture`: messages are appended to a JSONL file, never sent, even if a key is present |
| Google OAuth, FRED, Alpha Vantage | blank |
| Cron secret | a throwaway value |

`scripts/run-e2e.sh` always builds into a unique directory (`.next-e2e-<port>-<pid>`), starts everything, and runs
Playwright in three phases (`main`, `workflow`, `team-profile`). `playwright.config.ts` throws
unless `E2E_ISOLATED=1` and the environment passes `assertIsolatedServiceEnv`, so a bare
`npx playwright test` refuses to run. `tests/unit/test-services-isolation.test.ts` and
`tests/unit/email-capture.test.ts` pin this behaviour. The shell launchers propagate guard failures before any SQL, cleanup or build. They refuse existing servers and occupied service ports, and stop only their own processes. Builds use a private tsconfig so Next cannot edit the development configuration. Saved role sessions, logs, JSON reports and traces are scoped by run ID.

Not modelled by the local stand-ins: Supabase storage RLS policies, signed URLs, image
transformations, CDN behaviour, real email delivery, Google sign-in.

## Browser suites (`tests/e2e/wf-*.spec.ts`)

Real clicks and typing. Databases and APIs are used only to prepare or read back state.

| Spec | Covers |
|---|---|
| `wf-controls` | remaining table/footnote actions, all spacing options, counts/theme, correction/commendation/feature/pin, slug/author/status and editor publication controls |
| `wf-formatting` | one article using every editor control; checked in the editor, after save + reopen, in the review preview, and published |
| `wf-lifecycle` | writer and editor sessions: create, save, submit, feedback, revise, schedule, publish, unpublish, with permissions and public visibility at each step |
| `wf-failures` | failed / slow / hung saves, expired session, double clicks, edits in flight, two tabs, a failed publish |
| `wf-upload` | figure, cover (two controls), pasted images, invalid/oversize/failed uploads, who may upload |
| `wf-articles` | article list publish/unpublish, move to trash, restore, delete forever |
| `wf-roles` | menu per role, every menu page opens, pages outside a role are refused, sensitive endpoints refuse wrong roles |
| `wf-reader` | a new reader: sign up, comment, save, profile tabs, rename, sign out/in, delete account |
| `wf-layout` | the editor fits 1100–1920 px windows |
| `wf-mobile` | the working flow on a phone |

Projects: `wf-chromium`, `wf-webkit` (desktop Safari engine), `wf-mobile-chromium` (Pixel 7),
`wf-mobile-webkit` (iPhone 14). The `team-profile` specs now run in every full run.

## Conventions

- A successful action must assert its exact status (201 create, 200 update), not "not 5xx".
- Reopen what was saved; do not trust the "Saved" badge.
- `collectConsoleErrors` ignores only third-party image/font failures. A failed request to
  this site's own URLs is an error.
- Specs run in parallel and share one database and one storage server: use `uniqueTitle()`
  (cleaned up per worker by `removeMyArticles()`), and count stored files by name, not in total.
- Never use `Control+End` to move the caret (it differs on macOS); use `ArticleEditorPage.moveToEnd()`.

See [coverage-inventory.md](./coverage-inventory.md) for what each role can do and which test covers it.

## Reproducing the isolated audit

```sh
PGPORT=55434 PGDATA=/tmp/consilium-workflow-isolated-pg PGSOCK=/tmp \
  TEST_DATABASE_URL=postgresql://postgres@localhost:55434/consilium npm run test:setup-db
TEST_DATABASE_URL=postgresql://postgres@localhost:55434/consilium \
  E2E_APP_PORT=3321 FAKE_STORAGE_PORT=55422 \
  EMAIL_CAPTURE_FILE=/tmp/consilium-workflow-isolated-outbox.jsonl SKIP_DB_SETUP=1 \
  E2E_INVENTORY_DIR=/tmp/consilium-workflow-isolated/test-results/inventory npm run test:audit
```

The launcher prints its evidence directory. JSON, screenshots and retained failure traces
are under `test-results/<run-id>/<phase>/`; HTML reports are under
`playwright-report/<run-id>/<phase>/`. Open a failure using
`npx playwright show-trace <path-to-trace.zip>`. Large artifacts are ignored by git and
uploaded by the existing CI job. Never reuse builds with `SKIP_BUILD`, or attest a
pre-existing app using `AUDIT_BASE_URL`; both shortcuts bypass the isolation evidence.

Regenerate the source inventory with
`npx ts-node -P tsconfig.seed.json scripts/build-workflow-inventory.ts`. The JSON lists
page routes, inherited controls, options, dynamic control families, native dialogs,
source handlers, disabled conditions and candidate test references. Those references
are inspection evidence; only the run report establishes executed behaviour.
