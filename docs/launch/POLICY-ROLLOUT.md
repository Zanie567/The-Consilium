# Public-access hardening: production rollout (operator checklist)

Migration `supabase/migrations/20261018002859_launch_public_access_hardening.sql`. **Merging the PR does not apply
it**, and nothing in this repository applies it automatically. Each step marked *approval* needs the owner's explicit
go-ahead at the time. Rehearsed end to end on a disposable local Supabase stack by
`scripts/db/data-api-harness.sh` (CI job **Data API permissions**), which runs these exact files.

## What it fixes (confirmed on production, read-only, 2026-10-22)

Anyone holding the public anon key (it ships in every page) can call the Data API directly, bypassing the site:

| # | Exposure | After |
|---|---|---|
| 1 | Trashed articles (and any with the hidden-by-debate marker) stay readable, full text included, because the policy checks `status` only. 2 such articles exist. | Policy matches the site: `PUBLISHED`, not trashed, not hidden by a debate. |
| 2 | Their tags stay readable. | Tags follow the article policy. |
| 3 | Inactive and hidden team cards are readable (`USING (true)`). | No direct reads; the site serves the roster through Prisma. |
| 4 | Any Supabase Auth user can upload any file type and size into `article-images` (dashboard policy), bypassing `/api/upload`. 0 such uploads and 0 Supabase Auth accounts exist today. | Dropped. Uploads stay server-side (service role, after RBAC, size and content checks). |
| 5 | Anyone can **list** `article-images`, enumerating images uploaded for unpublished drafts (dashboard policy). | Dropped. Public image URLs keep working: a public bucket serves them without a policy. |
| 6 | `users_display_titles_valid` has no pinned `search_path` (advisor warning). | Pinned to `pg_catalog`; behaviour and CHECK unchanged. |

The 35 "RLS enabled, no policy" advisor notices are expected: those tables are server-only by design (deny-by-default).

## Not touched (confirm, do not change)

- Corrections migration `20261017120000` (already applied 2026-10-20) and its trigger.
- Hidden-debate triggers, scheduler, the anon column allowlist (41 columns on 6 tables), any row of content.

## 0. Prerequisites

- [ ] The security PR's CI is green on its head commit, including **Data API permissions**.
- [ ] Supabase Dashboard → Integrations → GitHub: "Deploy to production" is **OFF** (otherwise a merge could apply
      migrations outside this procedure).
- [ ] Record the deployed production commit SHA (Vercel → Deployments → Production).
- [ ] Confirm nothing outside this repository reads `team_members` or uploads to Storage with a Supabase Auth token
      (the repository has no such client; external integrations were not inventoried).

## 1. Fresh verified backup (owner, on the Mac) — *approval*

Follow `docs/remediation/backup-and-verify.md` steps 5–9: row counts, encrypted backup, **VERIFIED**, restore
rehearsal, second copy. Keep the earlier verified backup. Record folder name and verification output (no secrets).
**Stop if any step fails.**

## 2. Session set-up and preflight (read-only)

Session set-up exactly as in `docs/corrections/PRODUCTION-RUNBOOK.md` (one hidden password prompt, `PGPASSFILE`, no
connection string on any command line; `supabase link --project-ref scllbuwkcqtmfogsgalt` in this checkout). Then:

```bash
psql -X -v ON_ERROR_STOP=1 -f docs/launch/production/preflight.sql | tee preflight.txt
```

- [ ] Every row of the first result shows `ok = t`. These checks returned all `t` on production on 2026-10-22
      (read-only). If any row is `f`, **stop**: something changed since review. Do not edit an expectation to pass.
- [ ] Note the informational counts and the **content fingerprint**.

## 3. Apply (one transaction, self-verifying) and record — *approval*

```bash
psql -X -v ON_ERROR_STOP=1 -f docs/launch/production/apply.sql | tee apply.txt
```

- [ ] Ends with `public-access hardening verified: N live article(s) visible to anon, content unchanged` and `COMMIT`.
      Any failed precondition or postcondition rolls everything back; investigate before retrying.
- [ ] Only if that exited 0: `supabase migration repair --status applied 20261018002859 --linked` (registry row only).
- [ ] `supabase migration list --linked`: `20261018002859` local = remote; nothing else changed.
- [ ] **Never** `supabase db push` (see `docs/remediation/migration-registry.md`).

Locks: `ALTER POLICY`/`DROP POLICY` take brief exclusive locks on `articles`, `article_tags`, `team_members` and
`storage.objects`; `apply.sql` gives up after 5 s (`lock_timeout`) rather than queue behind traffic. Retry at a quiet
moment if it times out.

## 4. Verify (read-only)

```bash
psql -X -v ON_ERROR_STOP=1 -f docs/launch/production/verify.sql | tee verify.txt
```

- [ ] Every row `ok = t`; registry 26 rows; **content fingerprint identical to preflight**.
- [ ] Supabase → Advisors → Security: the function search-path warning is gone; RLS-without-policy INFO notices remain
      (expected).
- [ ] Through the site: home, a category page, Meet the Team, an article with images, and an authorised editorial
      image upload (into a draft) all work. Trash the test draft afterwards; its unused image is removed by the
      daily `cleanup-article-images` job.
- [ ] Do **not** read withdrawn production content to "prove" the fix: the adversarial checks run on synthetic data in CI.

## 5. Recommended dashboard hardening (separate, owner decision)

- Supabase → Authentication → Sign In / Providers: **disable new sign-ups** (the site uses NextAuth; 0 Supabase Auth
  accounts exist). After this migration it is defence in depth: no `authenticated` grant or policy remains.
- Supabase → Storage → `article-images`: consider a file-size limit and an image MIME allowlist matching
  `/api/upload` (`avatars` already has both). Check against the editor's accepted types before setting.

## Rollback

- A code rollback does **not** undo database policies, and none is needed: the app does not depend on these policies.
- Reverting reopens the exposures, so fix forward. If a legitimate client turns out to need one of these paths, give
  it a narrowly scoped replacement instead of restoring the old policy. The exact reversal SQL is at the end of the
  migration file. (The authenticated upload policy should not be recreated.)
- Never restore an old full database to undo this migration.
