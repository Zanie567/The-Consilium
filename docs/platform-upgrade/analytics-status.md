# Analytics workstream status

Updated 2026-10-06. **Not started: specialist features are not implemented or verified by the foundation.**

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

ViewCounter→analytics/track, ArticleView/SiteView and analytics dashboard, signed-in ReadingProgress/read-through plus gamification. Time is scroll estimate; persistent sid ignores consent; duplicate legacy view endpoint/raw SQL schema mismatch.

## Remaining required work

Consent-aware active/focused/recent activity timing; >=300s engaged metric; bounded idempotent cumulative heartbeats; returning definition/retention; existing API/dashboard extensions/permissions/privacy documentation.

## Exclusive ownership

ViewCounter, analytics routes/dashboard, new engagement helpers and timing/persistence tests, privacy text.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

Propose ArticleEngagementSession with unique visit key, monotonic timing, article/time + reader/time indexes, no unnecessary account/raw-IP data and RLS. Integrator handles schema/migration. Do not repurpose ReadingProgress as time.

## Required evidence

Fake timer hidden/blur/idle/resume tests; duplicate/out-of-order/clamped heartbeat DB tests; five-minute threshold once/session, returning-day/consent expiry; ADMIN/GROWTH-only UI/API; failures do not disrupt reading.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.
