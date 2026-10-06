# Team workstream status

Updated 2026-10-06. **VERIFIED COMPLETE** — verified on guarded local services; no production changes.

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Foundation audit (historical)

Account-linked unique team profile, Growth self-service, legacy matching/admin linking/photo cleanup and tier builder already implemented. Linked editorial chief/deputy remain inside editorial section; labels differ from spec.

## Acceptance work identified at foundation (completed below)

Pyramid chief/deputies→Editorial Team→Writers→Growth & Comms, one deputy/empty/mobile states and stable ordering; preserve title authority and legacy cards; prove Growth/profile permissions.

## Exclusive ownership

teamHierarchy/teamProfiles/teamProfileLegacy/teamPhotoStorage, team page/cards/dialogs, self-profile route/form, admin team/link routes; tests.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change; keep auth Role enum. Chief/deputy are admin appointments, no self-role inputs. ADMIN linked-card eligibility requires reviewed proposal; do not silently weaken mapping.

## Required evidence

Randomized mixed hierarchy fixture; unique/concurrent profile and legacy adoption; forged owner/team/title/admin rejection; writer/editor/Growth create/edit/reload/public; serial Playwright fixtures.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Foundation implementation record (historical)

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

Historical handoff instruction: the assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.

## Sequential implementation evidence (2026-10-06)

Branch/worktree: `feature/consilium-upgrade-six-workstreams` in `/Users/zanie/The-Consilium-upgrade`, foundation `68b26e8`. Shared changes integrated sequentially; existing auth Role enum and profile/account schema unchanged.

Appointed editorial Editor-in-Chief now occupies the single centred lead row; Deputies have a separate row of at most two feature cards. Additional deputies remain visible in Editorial Team. Public headings are exactly Editorial Team, Writers, Growth & Comms. Existing specialist legacy leadership and the documented untitled Lucas Dwyer exception remain between deputies and Editorial Team, as required by Foundation compatibility. Routine name/bio/photo updates preserve admin-appointed titles and explicit order. Stable ordering ends with normalized name and ID, independent of insertion order. Empty sections are omitted.

Writing/Growth titles cannot promote cards to the masthead. Existing server checks, unique account-linked profiles, legacy adoption, image safety and admin linking are retained and verified. Growth can create/edit/photo/save/reload and appear publicly; forged owner/team/title/admin requests cannot escalate roles.

Actual tests: **119/119** targeted unit/real-DB/storage cases (team portion of the 135-case combined Team/Growth run). Randomized/permuted mixed hierarchy, excess/one deputies and empty sections covered. Existing serial Chromium suite **41/41** passed, including real sign-up/promotion, writer/editor/Growth lifecycle, duplicate/concurrent creation, impersonation/forged fields, image replacement/deletion, role changes, public appearance and mobile/desktop QA. JWT refresh caught up in 60s while server permissions changed immediately. Typecheck and affected lint passed. Browser console/page exceptions checked by the lifecycle tests; intentional invalid-upload 400s excluded explicitly. Local logs `/tmp/consilium-upgrade-team-*`. Tablet overflow assertion added to public responsive check for final integration run.

No new migration. No production configuration required for this workstream. Complete repository regression is recorded by the final integration ledger.

## Final integrated evidence

See [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md) for the final combined verification, migration applications, configuration requirements and Git milestones. Final Vitest: **72 files; 996 passed, 7 existing expected failures, 18 existing skips**. Full integrated Playwright: **115/115 passed**, including the opt-in team project. No tests were removed or newly skipped. These states describe the local candidate, not a production rollout.
