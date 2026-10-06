# Figures workstream status

Updated 2026-10-06. **Not started: specialist features are not implemented or verified by the foundation.**

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

Figure src/alt/caption/credit and legacy image renderer; server bucket/MIME checks and local Storage emulator. Foundation extracted FigureNode and figureRender without new behaviour.

Foundation compatibility evidence: three figure rendering/sanitization regressions and existing editor bold/upload/caption/credit draft save/reload checked in local Chromium at 375/768/1440. The test-only local image configuration is verified separately. This does not verify new metadata, replacement/cleanup or the complete figure publication acceptance flow; see VERIFICATION.

## Remaining required work

Alt/decorative editing, source/sourceUrl/note/dimensions/layout and safe metadata; replacement/deletion; robust upload cancel/retry/failure/duplicate handling; reference-safe cleanup; preview/public parity.

## Exclusive ownership

components/editor/extensions/FigureNode.tsx, lib/figureRender.ts, new figure UI/upload adapter/CSS, article upload policy adapter and tests. The shared `/api/upload` route is integrator-owned; submit the scoped article-bucket patch there.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change by default; metadata in JSON. Asset registry only if reference-safe cleanup cannot be supported, with proposal/evidence. Upload route is shared with Team: preserve avatar semantics.

## Required evidence

Mandatory figure upload→preview→metadata→save/reload→review→publish; replace/delete with unrelated storage retained; malicious metadata/URLs, failed/cancelled upload, multiple figures and long mobile captions.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.
