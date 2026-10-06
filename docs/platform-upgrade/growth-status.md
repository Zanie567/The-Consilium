# Growth workstream status

Updated 2026-10-06. **Not started: specialist features are not implemented or verified by the foundation.**

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

Subscriber unique email, real subscribe form/API, HMAC unsubscribe, Growth subscriber tooling, generic LinkedIn constant and existing X/Facebook/LinkedIn/copy shares.

## Remaining required work

Concurrent-safe normalized subscriptions/friendly states; configurable real LinkedIn via SiteSetting; all social instances; canonical shares and clipboard fallback/email/native share where appropriate.

## Exclusive ownership

NewsletterSignup, subscribe/unsubscribe, ShareButtons, new typed site-settings/social loader and Growth subscribers, tests.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change by default. SiteSetting publication_linkedin_url existing KV. Any case-insensitive historical subscriber reconciliation needs preflight/proposal; constants/seo/Footer/layout patches integrator-owned.

## Required evidence

Valid/invalid/duplicate/case/concurrent email, network/server/double-click states and unsubscribe preservation; missing/valid/unsafe LinkedIn; every share canonical encoded URL/clipboard denial; labelled mobile forms.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.
