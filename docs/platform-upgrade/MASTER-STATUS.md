# Platform upgrade — master status

Updated 2026-10-06. **Foundation phase only. The upgrade features are not complete.**

[MASTER-SPEC.md](MASTER-SPEC.md) is the full authoritative acceptance specification. [ARCHITECTURE.md](ARCHITECTURE.md) records the repository audit, complete publication lifecycle, binding contracts, ownership and risks. No acceptance criterion is waived by this status.

## Branch and foundation

Integration branch: `feature/consilium-platform-upgrade`; audit base `029eef3`.
Foundation commit: **`d1dab80b8eb72f986c2b8a2f0fffdb4722f0f19a`**. Pinned by local immutable tag `consilium-platform-foundation-20261006`. All shared code/contracts and verified evidence are in that commit. This subsequent documentation-only handoff commit records its numeric hash; specialist branches start from the foundation, not a moving integration HEAD.

Pre-existing state: no tracked edits at start; many untracked `.next-e2e*` generated builds/configs, `docs/testing/` and `supabase/.temp/`. Preserved in place. New ignore rules hide generated Next artifacts without deleting them. The final tree may still show the pre-existing documentation/temp directories; they are not part of this foundation.

## Implemented foundation

- Complete product specification and six independently maintained status files.
- Repository/lifecycle audit and fixed architectural/workstream/migration boundaries.
- Shared `src/lib/richContent.ts`: document/mark JSON attributes including native table arrays; optional figure/table metadata contracts. This is a type contract, not feature support or runtime validation.
- Extracted existing `FigureNode` to `src/components/editor/extensions/FigureNode.tsx` and public image/figure renderer to `src/lib/figureRender.ts`. Existing serialization/output preserved; Figures and Editor can work separately.
- Shared public-list cache helper now uses Next 16 Route Handler-compatible `revalidateTag('articles', { expire: 0 })`. Added missing post-commit invalidation for directly created published articles and restored published articles.
- TypeScript/ESLint/git generated E2E artifact handling; archived browser-report bundles excluded from source linting. No source tests disabled.
- `scripts/platform-check.ts`: preserves existing fail-closed DB policy, isolates app/storage on loopback and blanks external email/OAuth/config credentials before local build/server/tests. Same arguments/environment used at build/runtime. Synthetic local test secrets only.
- Shell launchers now propagate database-resolver failure before eval; the canonical host policy itself is unchanged. Live API audit reading-progress uses an owned synthetic article instead of corrupting shared sample fixtures.
- Vitest files run serially against their shared seeded DB to avoid count/fixture races. Separate specialist DBs retain parallel workstream development.
- Existing local image-optimizer flag now validates an HTTP loopback URL without credentials. With the additional TEST_HARNESS flag, CSP allows only that exact image origin; default production CSP remains unchanged. This permits real Tiptap figure preview in isolated tests.
- Regression checks for figure-render compatibility/sanitization and publication-cache create/restore/auth/failure boundaries; existing cache test updated to assert supported API.

No schema changes or new feature implementations. No role enum, second taxonomy, replacement editor, analytics dashboard or new newsletter provider.

## Architecture decisions and shared contracts

| Domain | Binding decision | Evidence / later owner |
|---|---|---|
| Formats | Existing Category FK; initial News/Opinion/Analysis; preserve Interviews and legacy URLs; drafts may be uncategorized. | Discovery owns future validation/presentation, not a new enum. |
| Topics | Existing Tag + ArticleTag; stable existing IDs/slugs; normalize new names/slugs, rename label only, guard in-use deletion; display normalized name/id order; 1–3 guidance. | Discovery owns normalization/reconciliation; current code has legacy slug/case gaps. |
| Filtering/search | Format AND topics; multi-topic OR; repeated tag query parameters, bounded pagination/sort/count; extend current search with topics/authors and proper errors. | Discovery, not yet implemented. |
| Rich content | Tiptap 3 JSON string in Article.content; native table nodes; metadata in node attrs; optional figure src/alt/caption/credit/source/sourceUrl/note/decorative/dimensions/layout. | Editor owns tables/paste; Figures owns extracted modules; integrator owns dispatch/sanitizer. |
| Roles | ADMIN/EDITOR/WRITER/GROWTH/READER remain auth roles; chief/deputy are admin-assigned public titles, normally EDITOR; linked section derives from actual account role. | Existing RBAC/scope/self-profile guards preserved; Team fixes tier presentation. |
| Analytics | Extend ViewCounter→`/api/analytics/track`→existing dashboard. Active time is a new metric, not current scroll estimate; >=300 visible/focused/recently active seconds; idempotent 30s cumulative heartbeat. | Analytics owns persistence/consent/timers/metrics. |
| Site config | Reuse SiteSetting key `publication_linkedin_url`, typed Growth loader and validation; unset hides link; canonical production origin never derives from preview host. | Growth implements. Actual LinkedIn value required before release. |

Existing zero category assignments mean global editor, not no permissions. Existing Growth analytics permissions remain ADMIN/GROWTH only. ADMIN is not automatic public chief or self-profile eligibility. Legacy cards/leadership exceptions remain until explicitly addressed, not silently removed.

## Migration ownership

**No foundational migration is needed or created.** Existing shared structures suffice.

- Discovery proposes topic reverse index, safe name-identity constraint/reconciliation and in-use Tag FK restriction. It must preserve stored tag URLs and preflight existing rows; no blind cleanup.
- Analytics proposes engagement-session persistence, monotonic checks/idempotency/indexes/RLS and additive Article relation.
- Editor, Figures, Team and Growth require no new schema by default. Any asset registry, appointment role or subscriber reconciliation migration requires evidence and integration review first.
- **Integrator alone edits Prisma schema and canonical migration files**, serializes migration concepts/ordering, tests SQL against empty/populated local databases and documents rollback. Specialists submit proposals in their domain/status, not competing schema edits.
- Local foundation DB was created/seeded using existing guarded Prisma db push. Existing storage test schema and `20261001_team_member_user_link.sql` were applied to this isolated localhost cluster for storage tests. This is not a new foundation migration or proof of historical full migration replay.
- Historical production migration drift is documented in repository; not re-introspected in this phase. No production CLI/migration action was run.

## Workstream boundaries

| Workstream | Owns | Must hand off |
|---|---|---|
| [Discovery](discovery-status.md) | Categories/topics/query/filter/search pages/helpers and tests | Metadata/controller/API glue; schema/migration proposals. |
| [Editor](editor-status.md) | Tiptap parent, paste, table extension/public table module/editor controls and tests | Renderer dispatch, sanitizer, controller/API glue. |
| [Figures](figures-status.md) | Extracted FigureNode, figureRender, figure UI/upload adapter/article upload adapter and CSS/tests | Shared upload-route patch via integrator, article parent/sanitizer. |
| [Team](team-status.md) | Hierarchy/roster/profile/photo/admin-team domains and tests | RBAC/auth/user-role route changes and shared uploads. |
| [Growth](growth-status.md) | Newsletter/shares/settings/social/Growth subscribers and tests | Footer/layout/constants/SEO imports via integrator. |
| [Analytics](analytics-status.md) | Tracker/collection/analytics API/dashboard/privacy/timing tests | Schema/migrations, public article/layout and reading-position integration. |

Integrator-owned shared files: Prisma schema/config/migrations; auth/RBAC/proxy; richContent; articleRender dispatch/articleSanitize; article mutation/review/trash/scheduler; ArticleEditor controller/types/metadata panel; public article parent; globals.css; constants/seo/Footer/layout; next.config; test safety configs/scripts/CI. Specialists supply isolated patches/new modules, integrator applies shared edits sequentially. Do not overwrite another workstream's implementation.

## Verification ledger

Baseline and final results, logs and browser evidence are recorded in [VERIFICATION.md](VERIFICATION.md): typecheck/lint/build passed; 587 unit passes plus 7 existing expected failures; 306 integration passes plus 18 existing skips; full Vitest 893 passes across 58 files; 101 Playwright passes serially. Responsive inspection and figure extraction save/reload checked. Full upgrade/browser acceptance remains open; expected failures, skips and environment limits are retained explicitly.

## Risks and readiness

Architectural decisions permit independent development from the pinned foundation. No specialist branch/worktree was created or feature work launched. Analytics persistence/Discovery DB enforcement have explicit later integrator schema gates. Release is blocked until all MASTER-SPEC criteria pass and the owner provides/configures the real LinkedIn URL.

Handoff Git state: all foundation changes committed; tracked working tree clean. Pre-existing untracked `docs/testing/` and `supabase/.temp/` remain intact. Other existing worktrees were not changed. Owned foundation app/Storage/Postgres services were stopped after verification; isolated test DB files remain under the owned temporary PGDATA path. Nothing pushed, merged or deployed; production unchanged.

Known code risks owned in ARCHITECTURE: table/public-renderer parity; unsafe paste and unsupported toolbar marks; upload limits/cleanup/AVIF validation; linked-chief/deputy placement and legacy exceptions; newsletter concurrency and canonical shares; analytics consent/raw SQL column drift/active time; review/scheduler races and missing revision conflict detection; historical migration drift.

Known verification limitations: archived build artifacts initially polluted checks; Playwright team fixtures need serial execution and independent test DB; Vitest files now run serially to prevent signup/count races; the live API audit formerly polluted the three-reader fixture and now uses its own article. Browser and DB suites still must not share simultaneous fixture mutation, and re-seeding does not remove extra progress rows. Use a fresh isolated test database when fixtures have been contaminated. Negative team fixture `/team/x.png` produces an image error in standalone browser inspection. Local Node 20 differs from repository Node 22. Local Storage emulator is not real Supabase RLS/CDN/signed-URL proof. No production verification performed.

## Exact specialist branch/worktree instructions

Use the pinned `FOUNDATION_COMMIT` below. Do not use a moving branch HEAD and do not share `/Users/zanie/The-Consilium`. Run each command from the integration checkout. New paths must not already contain someone else's work; check `git worktree list` first.

```sh
FOUNDATION_COMMIT=d1dab80b8eb72f986c2b8a2f0fffdb4722f0f19a

git worktree add -b feature/consilium-upgrade-discovery /Users/zanie/The-Consilium-discovery "$FOUNDATION_COMMIT"
git worktree add -b feature/consilium-upgrade-editor /Users/zanie/The-Consilium-editor "$FOUNDATION_COMMIT"
git worktree add -b feature/consilium-upgrade-figures /Users/zanie/The-Consilium-figures "$FOUNDATION_COMMIT"
git worktree add -b feature/consilium-upgrade-team /Users/zanie/The-Consilium-team "$FOUNDATION_COMMIT"
git worktree add -b feature/consilium-upgrade-growth /Users/zanie/The-Consilium-growth "$FOUNDATION_COMMIT"
git worktree add -b feature/consilium-upgrade-analytics /Users/zanie/The-Consilium-analytics "$FOUNDATION_COMMIT"
```

Do not create these worktrees until specialists are assigned; foundation does not launch specialist implementation. Each specialist reads AGENTS.md, MASTER-SPEC, ARCHITECTURE, MASTER-STATUS and its own status before work. Select Node 22 from `.nvmrc`. Use `npm ci` in the separate tree with local test env explicitly supplied so postinstall never loads production credentials. Do not copy `.env.local`, external secrets or generated builds from the main checkout.

Use isolated local Postgres cluster/DB and app/storage ports per specialist:

Before setup, check that the assigned ports have no unrelated listener and PGDATA is absent or belongs to this stream. Never reuse/reset another worktree's cluster. If a listed port/path is already occupied, the integrator records a new unused assignment before setup. Do not delete an existing path to make these commands work.

| Stream | PG port | App port | Fake Storage port | PGDATA |
|---|---:|---:|---:|---|
| Discovery | 55500 | 3210 | 55600 | /tmp/consilium-upgrade-discovery-pg |
| Editor | 55501 | 3211 | 55601 | /tmp/consilium-upgrade-editor-pg |
| Figures | 55502 | 3212 | 55602 | /tmp/consilium-upgrade-figures-pg |
| Team | 55503 | 3213 | 55603 | /tmp/consilium-upgrade-team-pg |
| Growth | 55504 | 3214 | 55604 | /tmp/consilium-upgrade-growth-pg |
| Analytics | 55505 | 3215 | 55605 | /tmp/consilium-upgrade-analytics-pg |

Example for Discovery (substitute the exact values in the table for each stream):

```sh
cd /Users/zanie/The-Consilium-discovery
export TEST_DATABASE_URL=postgresql://postgres@localhost:55500/consilium
export PGPORT=55500
export PGDATA=/tmp/consilium-upgrade-discovery-pg
export PLATFORM_TEST_PORT=3210
export PLATFORM_TEST_STORAGE_PORT=55600
# The following values are local test fixtures, not external credentials.
export DATABASE_URL="$TEST_DATABASE_URL"
export DIRECT_URL="$TEST_DATABASE_URL"
export TEST_HARNESS=1
npm ci
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run test:setup-db
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run typecheck
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run lint
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run build
```

Storage setup only in that specialist's guarded local cluster (use installed psql path/PGBIN if needed):

```sh
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/e2e/helpers/local-storage-schema.sql -f supabase/migrations/20261001_team_member_user_link.sql
# Terminal 1: fake Storage. Terminal 2: app, using the table's app port.
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npx ts-node -P tsconfig.seed.json tests/e2e/helpers/fake-storage-server.ts
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm run start -- -p 3210
# Terminal 3: run only after local app + Storage are ready.
npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npm test
E2E_TEAM_PROFILE=1 npx ts-node -P tsconfig.seed.json scripts/platform-check.ts npx playwright test --workers=1
```

Terminals must inherit the same exports; use the wrapper for both build and runtime. No browser tests against arbitrary localhost servers: verify this server started with your isolated DB/env. Baseline suite uses RATE_LIMIT_DISABLED for functional load; original rate-limit unit coverage remains. Do not run DB tests concurrently with browser fixture mutation. Submit local commits and update only your stream status with actual tests, exclusions, migration proposals and shared-file patches. Integrator reviews commits/shared patches and runs full regression in the later integration assignment. No pushes, merges, deploys or production changes are authorized by this foundation handoff.
