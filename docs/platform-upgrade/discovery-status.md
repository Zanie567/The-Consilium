# Discovery workstream status

Updated 2026-10-06. **IMPLEMENTED BUT NOT FULLY VERIFIED** — targeted verification passed; complete combined publication/cache regression remains for integration.

Authority: MASTER-SPEC.md. Contracts: ARCHITECTURE.md. Isolation/sequence: IMPLEMENTATION-PLAN.md. Original checkout work untouched.

## Implemented

- Existing Category FK retains News/Opinion/Analysis, Interviews and legacy URLs. Existing public navigation already exposes these formats.
- Topic names use NFKC/collapsed whitespace; canonical identities collapse case, punctuation and slug separators. New URLs use canonical identity; existing IDs/slugs are resolved and retained. Editor preserves readable punctuation/case, rejects equivalent duplicates and guides 1–3 tags (existing exceptional cap remains 10 UI/25 server).
- Additive database migration `20261006153514_discovery_topic_identity.sql`: collision/blank preflight, canonical identity unique expression index, reverse topic join index, restrictive in-use deletion FK. No historical rows renamed/deleted. Applied only to fresh isolated local Postgres. Prisma includes reverse index/restrict relation. Rollback: restore original FK cascade and drop new indexes/function after application rollback; no data rewrite to reverse.
- Repeated `tag` query parameters use topic OR, format AND topics; GET checkbox form provides selection/removal, clear-all, page reset, shared URL refresh, bounded stable pagination and zero-results state. Filter permutations remain noindex.
- Archive selects metadata only. Tag page excludes deleted articles, bounds recent cards to 20 and links to complete filtered/paginated archive.
- Search keeps legacy array API; `scope=all` adds articles/authors/topics, 15 articles/page, 8 authors/topics, 200-character query/8 tokens/page cap, public-only relations, no bodies/private author fields, rate limit, no-store and friendly 503. Debounce/keyboard submit, abort stale requests, URL refresh, loading, empty/no-results/retry and mobile states.
- Topics cached under existing `articles` tag/30s; archive/search read live data. Existing post-commit publication invalidation retained.

## Actual evidence

- Targeted Vitest: **64/64** across article-tag normalization, archive pagination, discovery queries/database, create/save routes; plus **6/6** search route cases (70 total). Local Postgres concurrent resolution reused legacy ID/URL; DB duplicate and in-use deletion rejected; OR joins produced no duplicates.
- Playwright: **4/4 feature cases + 4/4 auth setup**. 375/768/1440 filter-select/multi-select/format/pagination/refresh/unselect/clear, no page overflow/uncaught exceptions/failed API responses. Mobile keyboard title/author/topic/no-results and mocked 503→retry passed. Initial selector ambiguity with Next's route announcer was corrected in the test; functionality was intact.
- Typecheck, whole-repo lint and production build passed for this milestone (Node 22, guarded local env).
- Interactive agent-browser archive navigation, topic checkbox/apply and zero-results/clear actions inspected; screenshot `/tmp/consilium-discovery-qa.png`. No browser error recorded. Full later visual matrix still required.

## Remaining verification/limitations

- Complete publication→tag edit→unpublish/restore/cache evidence will run with Editor/Figures lifecycle in integration. Expression migration must also be validated on empty schema and deliberately colliding historical fixture before final acceptance.
- No production migration/configuration performed. Historical collisions intentionally block migration and need explicit reconciliation preserving URLs.
- Search scans bounded metadata predicates without a new search engine; full-text indexing can follow measured scale. It deliberately does not scan/load complete document bodies.
