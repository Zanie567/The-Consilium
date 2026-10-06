# Figures workstream status

Updated 2026-10-06. **VERIFIED COMPLETE** — local acceptance and regression verified; production rollout not performed.

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Foundation audit (historical)

Figure src/alt/caption/credit and legacy image renderer; server bucket/MIME checks and local Storage emulator. Foundation extracted FigureNode and figureRender without new behaviour.

Foundation compatibility evidence: three figure rendering/sanitization regressions and existing editor bold/upload/caption/credit draft save/reload checked in local Chromium at 375/768/1440. The test-only local image configuration is verified separately. This does not verify new metadata, replacement/cleanup or the complete figure publication acceptance flow; see VERIFICATION.

## Acceptance work identified at foundation (completed below)

Alt/decorative editing, source/sourceUrl/note/dimensions/layout and safe metadata; replacement/deletion; robust upload cancel/retry/failure/duplicate handling; reference-safe cleanup; preview/public parity.

## Exclusive ownership

components/editor/extensions/FigureNode.tsx, lib/figureRender.ts, new figure UI/upload adapter/CSS, article upload policy adapter and tests. The shared `/api/upload` route is integrator-owned; submit the scoped article-bucket patch there.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change by default; metadata in JSON. Asset registry only if reference-safe cleanup cannot be supported, with proposal/evidence. Upload route is shared with Team: preserve avatar semantics.

## Required evidence

Mandatory figure upload→preview→metadata→save/reload→review→publish; replace/delete with unrelated storage retained; malicious metadata/URLs, failed/cancelled upload, multiple figures and long mobile captions.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Foundation implementation record (historical)

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

Historical handoff instruction: the assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.

## Sequential implementation milestone (2026-10-06)

Worktree `/Users/zanie/The-Consilium-upgrade`, branch `feature/consilium-upgrade-six-workstreams`, pinned foundation `68b26e8`. One integrator owns the shared routes/renderer/sanitizer; no competing content format. Article.content remains native Tiptap JSON strings. No production actions.

Actual evidence: targeted rich-content tests **49/49**, Chromium Playwright **3/3 feature scenarios + 4/4 authentication setup**. Typecheck, affected ESLint, production build pass. Tests exercise realistic three-column Google Docs clipboard, malformed/dangerous paste, cell links/formatting, row/column changes, repeated save/reload, writer submission, editor review/edit/schedule, publication, image replacement failure/replacement/deletion, public metadata and layouts at **375/768/1440**. Browser scenarios assert no page overflow and collect uncaught errors/API failures. Logs retained locally under `/tmp/consilium-upgrade-rich-*`.

Controls actually exercised: paragraph; headings 2/3/4; bold/italic/underline/strike; link add/remove; blockquote, code block, pull quote; ordered/unordered lists; indent/outdent; undo/redo; separator; four alignments; colour/highlight/reset controls; line spacing; footnote; print; keyboard table grid; header toggle; row/column add/remove; table deletion; Tab cell navigation. Table caption/source/source URL/note persist as native attrs. Plain text keeps native paste handling. HTML is bounded to 2MB/10 embedded images and unsafe attributes/URLs are removed.

Tables render through the shared public dispatcher and sanitizer. Editor/public use contained horizontal scrolling, readable cell text, no page-level overflow. Empty tables are dropped publicly. Heading/title fields resize on viewport changes.

Figures support alt/decorative semantics, caption, credit, source/link, note, dimensions, layout, replace/delete. Structured meaningful figures require alt before submission/schedule/publication; legacy images remain compatible. Uploads validate permissions, MIME signature, actual sharp decoding, dimensions/40MP and 4MB; avatars retain their existing policy. Failures preserve the original figure, duplicate action guard and abort controls are implemented.

Asset registry proposal/evidence: eager autosave deletion breaks Undo; abandoned upload receipts cannot be recovered reliably without a record. Additive `ArticleImageAsset` tracks only new owned image keys, reserves before upload, serializes reference saves/cleanup under advisory locks, and defers ordinary edits for 30 days. Permanent deletion checks all draft/trash/cover/content references. Daily authenticated cleanup takes at most 20 objects; legacy URLs are untouched. Migration `20261006160355_managed_article_images.sql` applied ONLY to guarded localhost database; RLS enabled with no browser writes. Production migration/configuration remains an operator step, not performed here.

Final evidence: full Vitest **988 passed / 7 existing expected failures / 18 existing skips**; explicit plain-text paste, upload cancellation/retry, custom text/highlight colours and remove/reset controls passed in Chromium. Cleanup auth/missing-secret/provider-failure cases passed. Editor screenshots at 375/768/1440 were manually inspected; long headline no longer clips, toolbar wraps, console clear. Public rich-block viewport/overflow and API/exception assertions passed. Linked image hosts continue using existing publication policy. Scheduled lifecycle was tested by setting a future schedule then explicitly publishing locally; the production scheduler was not run.

Final targeted browser acceptance: **4/4 rich-content scenarios** in the full integrated run, in addition to shared setup. New metadata-only figures omit broken image elements; malicious image URLs still leave safe captions/credits, and valid alt text remains escaped. The final whole-repository typecheck/lint/build pass. Daily image GC has a 40-second batch-start deadline plus transaction timeout to stay within the configured function budget. The integration ledger records final commits and full Playwright results.

## Final integrated evidence

See [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md) for the final combined verification, migration applications, configuration requirements and Git milestones. Final Vitest: **72 files; 996 passed, 7 existing expected failures, 18 existing skips**. Full integrated Playwright: **115/115 passed**, including the opt-in team project. No tests were removed or newly skipped. These states describe the local candidate, not a production rollout.

Final storage-integrity regression covers JSON-escaped slashes/Unicode, query/hash aliases, percent-encoded path/filename, URL-normalised paths, covers and legacy HTML. Saves lock canonical object URLs; cleanup decodes JSON inside PostgreSQL and conservatively retains any matching unique object filename. All drafts/trash remain included; no full article bodies are returned to the application for cleanup. A foreign URL with the same unique filename may delay cleanup rather than risk deleting a referenced object. Eight additional real-database cases pass.
