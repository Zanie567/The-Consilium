# Discovery workstream status

Updated 2026-10-06. **Not started: specialist features are not implemented or verified by the foundation.**

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

Existing Category/Tag/ArticleTag, tag/author/category pages, archive pagination and debounced article search. No multi-topic filtering; topics absent from search.

## Remaining required work

Normalize tags without changing old URLs; curated topics and 1–3 guidance; in-use delete guard; OR multi-filter + pagination/sort/URL/SEO; distinguish topic/author results and error states.

## Exclusive ownership

articleTags.ts, searchText.ts, archivePagination.ts, archive/search/category/tag pages, api/search; exclusive new discovery modules and tests.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

Propose reverse join index, normalized name identity/preflight and Tag FK RESTRICT. Integrator alone edits schema/migrations.

## Required evidence

Normalization/slug/collision tests; safe join/constraint integration; filters with OR/count/pagination; author/topic/title/no-results/error search; keyboard/mobile and post-publish tag revalidation.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.
