# Figures workstream status

Updated 2026-10-06. **IMPLEMENTED BUT NOT FULLY VERIFIED** — local milestone implemented; remaining checks below.

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

## Sequential implementation milestone (2026-10-06)

Worktree `/Users/zanie/The-Consilium-upgrade`, branch `feature/consilium-upgrade-six-workstreams`, pinned foundation `68b26e8`. One integrator owns the shared routes/renderer/sanitizer; no competing content format. Article.content remains native Tiptap JSON strings. No production actions.

Actual evidence: targeted rich-content tests **49/49**, Chromium Playwright **3/3 feature scenarios + 4/4 authentication setup**. Typecheck, affected ESLint, production build pass. Tests exercise realistic three-column Google Docs clipboard, malformed/dangerous paste, cell links/formatting, row/column changes, repeated save/reload, writer submission, editor review/edit/schedule, publication, image replacement failure/replacement/deletion, public metadata and layouts at **375/768/1440**. Browser scenarios assert no page overflow and collect uncaught errors/API failures. Logs retained locally under `/tmp/consilium-upgrade-rich-*`.

Controls actually exercised: paragraph; headings 2/3/4; bold/italic/underline/strike; link add/remove; blockquote, code block, pull quote; ordered/unordered lists; indent/outdent; undo/redo; separator; four alignments; colour/highlight/reset controls; line spacing; footnote; print; keyboard table grid; header toggle; row/column add/remove; table deletion; Tab cell navigation. Table caption/source/source URL/note persist as native attrs. Plain text keeps native paste handling. HTML is bounded to 2MB/10 embedded images and unsafe attributes/URLs are removed.

Tables render through the shared public dispatcher and sanitizer. Editor/public use contained horizontal scrolling, readable cell text, no page-level overflow. Empty tables are dropped publicly. Heading/title fields resize on viewport changes.

Figures support alt/decorative semantics, caption, credit, source/link, note, dimensions, layout, replace/delete. Structured meaningful figures require alt before submission/schedule/publication; legacy images remain compatible. Uploads validate permissions, MIME signature, actual sharp decoding, dimensions/40MP and 4MB; avatars retain their existing policy. Failures preserve the original figure, duplicate action guard and abort controls are implemented.

Asset registry proposal/evidence: eager autosave deletion breaks Undo; abandoned upload receipts cannot be recovered reliably without a record. Additive `ArticleImageAsset` tracks only new owned image keys, reserves before upload, serializes reference saves/cleanup under advisory locks, and defers ordinary edits for 30 days. Permanent deletion checks all draft/trash/cover/content references. Daily authenticated cleanup takes at most 20 objects; legacy URLs are untouched. Migration `20261006160355_managed_article_images.sql` applied ONLY to guarded localhost database; RLS enabled with no browser writes. Production migration/configuration remains an operator step, not performed here.

Remaining verification: full repository regression, explicit aborted-network upload browser case, plain-text browser paste and custom colour reset assertions; daily cron permission tests; manual screenshots/console inspection. Linked image hosts continue using existing publication policy. Scheduled lifecycle was tested by setting a future schedule then explicitly publishing locally; the production scheduler was not run.
