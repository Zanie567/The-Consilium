# Editor workstream status

Updated 2026-10-06. **Not started: specialist features are not implemented or verified by the foundation.**

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

Tiptap native tables and rich formatting, JSON saves, Google Docs cleaner, autosave queue, inline comments. Public renderer strips tables and multiple marks/styles; full paste lifecycle unverified.

Foundation browser inspection also found long headline clipping at 375px in the existing document title field (no horizontal page overflow). Include field-height/wrapping in Editor responsive QA; no foundation UI redesign was made.

## Remaining required work

Audit every toolbar control; safe realistic Docs paste; table editing/header/cell navigation/captions/source/note; table public module and contained overflow; save/reopen/review/schedule/republish parity.

## Exclusive ownership

TiptapEditor.tsx parent, cleanPastedHTML.ts, new table extension/public table renderer and editor CSS, toolbar/document controls; own tests.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change. Native table metadata in JSON attrs; shared richContent types fixed by foundation. Renderer dispatch/sanitizer/controller changes go through integrator.

## Required evidence

Mandatory three-column Docs fixture with bold/link/header/unsafe markup; native table controls; save/reopen/submit/review/publish public table; all toolbar options; 375/768/1440 layouts.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.
