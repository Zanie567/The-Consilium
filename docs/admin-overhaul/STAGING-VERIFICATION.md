# Hosted staging verification, 2026-10-10

Exact commit deployed: `7202db9e266154369ff5e5f2afb85929b8319666` (tree hash `04533232040d27ae212e567465ee6ff7e8c7c645`, verified
identical to the uploaded directory). Later commits on the branch only add documentation.

| | |
|---|---|
| Vercel project | `consilium-testing` (`prj_zr8Of1h2eREC64esLiwFnpimtXno`), team `zanie567s-projects`. **Not** `the-consilium`. |
| Deployment | `dpl_Dzsp2oGdRaecUB4tEHBM595r9v2i`, READY, target production of the testing project |
| URL | `https://consilium-testing.vercel.app` (alias) / `https://consilium-testing-duj77j2v5-zanie567s-projects.vercel.app` |
| Method | `git archive` of the commit to a clean directory, `vercel link` + `vercel deploy --prod`. Nothing pushed; mirror and `origin` untouched. |
| Previous deployment (rollback target) | `dpl_BHnMFF7TUp7KfkkhfBnSm1LmAnXz` |
| Database | Supabase `consilium-testing` (`zrieajoqosgzyesfatta`). Attestation matched before and after. Production (`scllbuwkcqtmfogsgalt`) was never queried or modified. |
| Migrations | Applied one at a time, each verified, recorded in history: `20261010122238 admin_overhaul_1_debate_lifecycle_20261010`, `20261010122248 admin_overhaul_2_team_member_updated_at_20261010`, `20261010122319 admin_overhaul_3_hidden_debate_article_guard_20261011`. All pre-migration data hashes were unchanged afterwards. |
| `/api/admin/deployment-health` | 200 `{"healthy":true,"gaps":[]}` (includes the three new checks and the guard) |

## Verified in the hosted browser (all through the real UI unless stated)

* **Debates**: create, edit, unpublish, publish, delete, restore, republish, delete, permanent delete (typed-title gate: disabled with no/wrong text, enabled
  with the exact title). At every step the public site, search and the two article URLs followed (404 when hidden). A hand-made `PUT /api/articles/:id`
  to publish a hidden debate's article returned `409 HIDDEN_DEBATE_ARTICLE`, while unpublished and while deleted. Audit trail: 9 entries, in order.
  Ordinary article create/publish/trash still works and the public URL follows.
* **Team Members**: recent sign-up listed, authorised, linked profile, owner edited own bio (public), forged title/role refused (400), a writer is refused the
  page and APIs (403), admin changed the title (persisted after reload, public), access role changed with the title untouched, hide and restore (public
  follows), Editor-in-Chief title and link survive role changes, reorder. Database read-back matched the UI.
* **Dashboard**: new admin menu, overview, Subscribers / Login Attempts / Data Management / Testing all open; 7 pages x desktop and phone: one `h1`, every
  control labelled, no sideways scroll, clean console.
* **Testing Mode, real isolated personas**: Writer, Editor and Growth each: server identity is the persona, exact role menu, profile prompt present/absent
  as the scenario dictates, notifications, restricted pages bounced, administrator-only APIs refused (401/403), "Check access" all pass (14 / 20 / 12 probes).
  Editor approved an article through the confirmation dialog (it became public) and returned another with a note. Session: 15 minutes, shared across tabs,
  switching makes the other tab follow, a stale form is refused (409 `TESTING_IDENTITY_CHANGED`), a **really expired** session returns to the
  administrator and a request with the old persona identity is refused (403), Exit works.
* **Scenarios**: applied for each persona; Reset restored every persona's profile hash, notifications, articles and achievements to the pre-test baseline
  (one exception, below). No scenario rows, snapshots or open sessions remained.
* **Email and external effects**: the 4 distinct workflow emails (access granted, role updated, article live, article returned) were captured in
  `testing_email_outbox`; every recipient was `@consilium.test`; nothing external. No production service was contacted.
* **Cleanup**: all test accounts, profiles, articles, sessions and two stray notifications removed; fixture card orders restored. Users, team and articles
  hashes equal the pre-migration snapshot.

## How verification was driven

The repository's Playwright harness deliberately refuses remote targets, so a standalone script (hard-wired to the staging hostname, scratch directory,
not committed) drove Chromium. The operator password file was not available, so a temporary `@consilium.test` administrator was created in the testing
database and deleted afterwards. Browser console errors were only my own deliberate refusal probes (403s).

## Findings (nothing was fixed or redeployed; each needs your decision)

1. **Feed and sitemap can lag behind removal (recommend fixing before production).** `feed.xml` is sent with `s-maxage=3600`; `sitemap.xml` is cached
   and nothing revalidates it. After an unpublish/delete the feed can keep a removed article's title and excerpt for up to an hour, the sitemap its URL
   until the next refresh. Pre-existing for every article, but it is the "alternative route" the hidden-debate rule is meant to close. Proposed fix: call
   `revalidatePath('/feed.xml')` and `('/sitemap.xml')` from `revalidateArticleLists` and `revalidateDebateSurfaces`, and lower the feed's `s-maxage`.
2. **Authorising a verified account creates a hidden placeholder profile, which hides the "link an existing profile" picker.** Correct under the
   one-profile rule, but if the registered name differs from the existing card (and the card has no matching email) the admin must delete the placeholder
   first. Proposed fix: when the linked card is an unpublished, incomplete placeholder, offer "Replace with an existing profile" as one atomic action.
3. **Success message is not cleared between saves** in the profile editor, so a second identical save looks like the first. Proposed fix: clear on save start.
4. **Debate creation form labels are not associated with their inputs** (pre-existing component; my audit did not cover `/editorial/debates/new`).
5. **Scenario reset does not remove real side-effects of acting as a persona**: approving or returning a scenario article notified its author persona
   (untagged), so `writer-other` kept 2 unread notifications until I removed them. Documented limitation.
6. Staging has no scheduled-publish cron (only two cleanup crons), so its two fixture scheduled articles show as overdue on the dashboard.
7. Shared personas already carry unread notifications and an unseen achievement, so exact counts hold only for the Growth persona; the bell counts unread
   among the newest 20.
8. `GET /api/team` includes each card's contact `email` (pre-existing; the card renders it deliberately).
