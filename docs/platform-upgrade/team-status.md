# Team workstream status

Updated 2026-10-06. **Not started: specialist features are not implemented or verified by the foundation.**

Authority: [MASTER-SPEC.md](MASTER-SPEC.md). Binding contracts/ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Branch/worktree and verification ledger: [MASTER-STATUS.md](MASTER-STATUS.md). Existing behaviour below is an audit finding, not a claim of full product acceptance.

## Existing implementation

Account-linked unique team profile, Growth self-service, legacy matching/admin linking/photo cleanup and tier builder already implemented. Linked editorial chief/deputy remain inside editorial section; labels differ from spec.

## Remaining required work

Pyramid chief/deputies→Editorial Team→Writers→Growth & Comms, one deputy/empty/mobile states and stable ordering; preserve title authority and legacy cards; prove Growth/profile permissions.

## Exclusive ownership

teamHierarchy/teamProfiles/teamProfileLegacy/teamPhotoStorage, team page/cards/dialogs, self-profile route/form, admin team/link routes; tests.

Do not independently edit integration-owned shared files listed in ARCHITECTURE. Submit a scoped patch/proposal and coordinate additive imports. Work only in this stream's isolated worktree and guarded test cluster.

## Schema ownership

No schema change; keep auth Role enum. Chief/deputy are admin appointments, no self-role inputs. ADMIN linked-card eligibility requires reviewed proposal; do not silently weaken mapping.

## Required evidence

Randomized mixed hierarchy fixture; unique/concurrent profile and legacy adoption; forged owner/team/title/admin rejection; writer/editor/Growth create/edit/reload/public; serial Playwright fixtures.

Run current baseline suite and targeted tests; record actual counts/errors/skip reasons and browser interactions. Preserve all safety guards and production boundaries. See VERIFICATION for pre-existing baseline limitations, especially fixture isolation.

## Implementation record

- Specialist branch/worktree: assigned from pinned foundation in MASTER-STATUS; not created by foundation.
- Specialist commits: none.
- New specialist migrations: none created/applied.
- Specialist tests/browser QA: none run; foundation baseline is separate.
- Shared-file patch proposals: none yet.
- Acceptance checklist: all remaining MASTER-SPEC criteria for this stream open.

The assigned specialist maintains this file with implemented behaviour, exact commits, actual evidence, migration proposals and unresolved gaps. Do not replace or weaken requirements with status notes.
