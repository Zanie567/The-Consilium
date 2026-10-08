# Six-workstream implementation plan

2026-10-06: user assigned all six streams to one engineer. Work proceeds sequentially in an isolated integration candidate at `/Users/zanie/The-Consilium-upgrade`, branch `feature/consilium-upgrade-six-workstreams`, based on handoff `68b26e8` (feature foundation `d1dab80`). This supersedes the foundation-only assignment; foundation contracts remain binding. No concurrent specialists or shared-file writers. The original checkout's uncommitted Discovery work and untracked files remain untouched.

Local services: Node 22.23.3 (download verified against official SHA256), Postgres 16 port 55510 / PGDATA `/tmp/consilium-upgrade-all-pg`, app 3220, fake Storage 55610. These unused assignments avoid all listed specialist services. Use `scripts/platform-check.ts` for build/runtime/tests. No production environment file copied; external email/OAuth are disabled.

Sequence:
1. Discovery: canonical tags/legacy IDs/URLs, OR filters, bounded article/author/topic search, URL/pagination/mobile; test database identity/index/restrict migration.
2. Editor and Figures: native Tiptap JSON, paste safety, table/format renderer parity, every control, structured figure metadata, storage validation/cleanup and lifecycle.
3. Team: linked leadership pyramid, deterministic ordering; existing Growth self-service and server permissions retained and tested.
4. Growth: shared SiteSetting LinkedIn, atomic subscriptions, canonical shares, error/keyboard/mobile.
5. Analytics: extend canonical collector/dashboard, consent-aware active time and cumulative idempotent sessions, migration/RLS, failure/permission tests.
6. Full regression, build, browser matrix, status/evidence, local coherent commits. No push/merge/deploy/production changes.

Audit source: MASTER-SPEC/MASTER-STATUS/ARCHITECTURE, all six status files, foundation commits and installed Next 16 documentation. Domain and integration edits are applied sequentially by this engineer. Migration preflights stop on existing canonical collisions; no automatic destructive reconciliation or legacy URL changes.
