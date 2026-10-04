# Testing The Consilium

Public appointment separation and simulator operations: [appointments-and-testing-mode.md](./appointments-and-testing-mode.md). Current acceptance/results: [acceptance-and-evidence.md](./acceptance-and-evidence.md).

## The suites

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Vitest: unit tests and in-process route-handler tests | test database for the DB suites |
| `npm run test:e2e` | Playwright, through `scripts/run-e2e.sh` (the only supported way) | `npm run test:setup-db` once |
| `npm run test:audit` | Vitest incl. the live-server API audit, then Playwright | as above |

`npm run test:setup-db` starts a throwaway local Postgres on port 5433, pushes the schema and seeds it.

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

`scripts/run-e2e.sh` builds into its own directory (`.next-e2e`), starts everything, and runs
Playwright in three phases (`main`, `workflow`, `team-profile`). `playwright.config.ts` throws
unless `E2E_ISOLATED=1` and the environment passes `assertIsolatedServiceEnv`, so a bare
`npx playwright test` refuses to run. `tests/unit/test-services-isolation.test.ts` and
`tests/unit/email-capture.test.ts` pin this behaviour.

Not modelled by the local stand-ins: Supabase storage RLS policies, signed URLs, image
transformations, CDN behaviour, real email delivery, Google sign-in.

## Browser suites (`tests/e2e/wf-*.spec.ts`)

Real clicks and typing. Databases and APIs are used only to prepare or read back state.

| Spec | Covers |
|---|---|
| `wf-formatting` | one article using every editor control; checked in the editor, after save + reopen, in the review preview, and published |
| `wf-lifecycle` | writer and editor sessions: create, save, submit, feedback, revise, schedule, publish, unpublish, with permissions and public visibility at each step |
| `wf-failures` | failed / slow / hung saves, expired session, double clicks, edits in flight, two tabs, a failed publish |
| `wf-upload` | figure, cover (two controls), pasted images, invalid/oversize/failed uploads, who may upload |
| `wf-articles` | article list publish/unpublish, move to trash, restore, delete forever |
| `wf-roles` | menu per role, every menu page opens, pages outside a role are refused, sensitive endpoints refuse wrong roles |
| `wf-reader` | a new reader: sign up, comment, save, profile tabs, rename, sign out/in, delete account |
| `wf-layout` | the editor fits 1100–1920 px windows |
| `wf-mobile` | the working flow on a phone |

The same formatting/lifecycle/upload/role/control/failure specs also run through genuine personas in `simulator-chromium`; `testing-mode` checks parity, revocation and switching. Projects: `wf-chromium`, `wf-webkit` (desktop Safari engine), `wf-mobile-chromium` (Pixel 7),
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
