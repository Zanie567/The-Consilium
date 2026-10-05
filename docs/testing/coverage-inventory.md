# Role and action coverage inventory

What each kind of account can open and do, and which automated test exercises it. Current appointment/testing-mode evidence and remaining limitations are in [acceptance-and-evidence.md](./acceptance-and-evidence.md); checks outside its recorded selections reflect the earlier workflow audit.

Methods: **BROWSER** = an actual control/navigation/form driven by Playwright; **API_DB** = an HTTP or database assertion alone; **UNIT** = in-process isolated behaviour; **INSPECTION** = source only; **UNAVAILABLE** = intentionally absent/disabled; **UNCOVERED** = enabled action not yet exercised; **EXTERNAL_BLOCK** = unavailable controlled integration/device. Fixtures prepare representative records; database read-back verifies persistence but does not replace the listed user action. Dynamic records are action families, not literal production rows. Equivalent palette colours/table dimensions share a family; distinct table actions and permission/state transitions are exercised separately.

## Routes and role menus

The complete final-source [route/control census](control-inventory.json) records every discovered page, inherited layout controls, button/link/form/input/tab/menu/switch declaration, enabled condition, handler, native dialog and dynamic map family. Its candidate tests are inspection references only. `wf-roles` validates exact Writer, Editor, Admin, Growth and Reader portal menus, clicks actual desktop menu links, and exercises all four authorised roles' phone drawer links/close/backdrop/theme/home/sign-out. Query-only navigation must close and unlock the drawer. Sensitive API boundaries remain separately identified. `wf-mobile` exercises the mobile editorial lifecycle and responsive controls. Rendered snapshots are captured automatically under each run's `inventory/<browser>/<role>.json`.

| Route family | Writer | Editor | Admin | Growth | Reader | Expected boundary / verification |
|---|---|---|---|---|---|---|
| `/editorial`, public `/profile` | Portal + profile | Portal + profile | Portal + profile | Portal + profile | Profile; portal denied | Role menus/pages BROWSER, `wf-roles`, `wf-reader` |
| Team Profile | Own | Own | Admin explanation/manage | Own | Denied | BROWSER `team-profile*`; public roster and ownership read-back |
| Articles/new/edit/My Drafts | Own | Managed/category scope | Any | Denied | Denied | BROWSER `wf-lifecycle`, `wf-articles`, `editor-scope`; direct API boundaries separate |
| Review/queue/scheduled/series | Denied review; submitted content locked | Managed scope | Any | Denied | Denied | BROWSER lifecycle/portal/controls; exact response/state/public visibility |
| Trash | Own permitted drafts/rejections | Managed scope | Any | Denied | Denied | BROWSER `wf-access`, `wf-articles`; restore/permanent-delete confirmations |
| Debates/comments | Denied management | Allowed | Allowed | Denied management | Denied management | BROWSER `wf-admin-content`, `wf-remaining`; API moderation boundaries separate |
| Calendar/predictions/users/glossary | Denied | Denied | Allowed | Denied | Denied | BROWSER `wf-portal`, `wf-admin-profile`; UNIT/API_DB boundary tests |
| Analytics/subscribers/engagement/writer metrics | Denied reports | Denied reports | Allowed | Allowed | Denied | BROWSER ranges/tabs/search/CSV; metrics partly UNIT/API_DB |
| Your Readers/leaderboard | Own metrics | Own | Any/management | Direct permitted leaderboard | Denied portal | BROWSER `wf-discovery` author/period/sort/detail controls; calculations UNIT/API_DB |
| Legacy `/admin/data`, `/admin/login-attempts`, `/admin/team` | Denied | Denied | Allowed | Denied | Denied | BROWSER `wf-remaining`, Team Profile; deletion API negative checks separate |
| Legacy `/admin/subscribers` | Denied | Allowed by existing route policy | Allowed | Denied | Denied | BROWSER navigation; portal subscriber workflows use Admin/Growth |
| `/predictions`, detail, leaderboard trial | Denied | Denied | Allowed | Denied | Denied | BROWSER `wf-portal`; intentionally gated trial |
| `/editorial/setup` | First-admin form only without existing admin | Same | Same | Same | Same | BROWSER conditional empty-admin fixture in owned database; existing-admin redirect/403 |
| Public home/category/archive/search/tag/author/article/debate/team/static policies/contact | Public | Public | Public | Public | Public | BROWSER `public`, `wf-discovery` category tabs/carousel/archive filters/pagination, `footnotes`, reader/mobile; API_DB crawl separate |
| Public login/signup/forgot/reset/unsubscribe/banned | Account/session-dependent forms | Same | Same | Same | Same | BROWSER account/access tests; captured transport only |

| Page | Writer | Editor | Admin | Growth | Reader |
|---|---|---|---|---|---|
| Dashboard `/editorial` | ✅ | ✅ | ✅ | ✅ | ⛔ Access Denied |
| Team Profile | ✅ | ✅ | assigned card form; otherwise explanation | ✅ | ⛔ |
| All/My Articles, My Drafts, New Article | ✅ | ✅ | ✅ | ⛔ redirect | ⛔ |
| Article Series, Scheduled | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| Trash | own articles only (no menu link) | ✅ | ✅ | ⛔ | ⛔ |
| Review Queue, review screen | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| Debates, Comments | ⛔ | ✅ | ✅ | ⛔ (comments API readable by Growth by design) | ⛔ |
| Calendar | ⛔ | ⛔ | ✅ (`CALENDAR_ACCESS_ROLES`) | ⛔ | ⛔ |
| Users, Predictions, Glossary | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| Analytics | ⛔ | ⛔ | ✅ | ✅ | ⛔ |
| Subscribers, Engagement, Writer activity | ⛔ | ⛔ | ✅ | ✅ | ⛔ |
| Your Readers | ✅ own | ✅ own | ✅ any | ⛔ | ⛔ |
| Leaderboard | ✅ menu | by URL | by URL | by URL | ⛔ |
| Public site, `/profile` | ✅ | ✅ | ✅ | ✅ | ✅ |

Every row maps expected behaviour to test locations and a verification method. Final run outcomes are pending; historical passes must not be described as final verification. Files live under `tests/e2e/` unless specified otherwise.

| Action | Writer | Editor/Admin | Test |
|---|---|---|---|
| Create, autosave, Save draft | ✅ | ✅ | `wf-lifecycle`, `wf-failures`, `editorial.spec` (autosave + reopen) |
| Title, excerpt, category, tags, cover URL | ✅ | ✅ | `wf-formatting`, `wf-upload`, `wf-mobile` |
| Slug, author, status dropdown | ⛔ hidden | ✅ saved, reloaded and scheduled | `wf-controls` |
| Submit for review | ✅ | n/a | `wf-lifecycle`, `wf-formatting`, `wf-mobile` |
| Editor notified (email captured + in-app) | | ✅ email; 🟡 in-app bell not clicked | `wf-lifecycle` |
| Internal note on review screen | | ✅ | `wf-lifecycle` |
| Return to writer with feedback | | ✅ | `wf-lifecycle` (button disabled without text; email carries the note) |
| Writer sees feedback, revises, resubmits | ✅ | | `wf-lifecycle` (note cleared on resubmit) |
| Publish Now (review screen) | | ✅ | `wf-lifecycle`, `wf-formatting`, `wf-mobile` |
| Schedule (review screen) | | ✅ future time; scheduler publishes | `wf-lifecycle` (cron call is a fixture) |
| Unpublish (review screen) | | ✅ | `wf-lifecycle` |
| Publish / Unpublish from the article list | | ✅ | `wf-articles` |
| Publish / Schedule / Unpublish buttons inside the editor | | ✅ persisted and publicly verified | `wf-controls`, `wf-failures` |
| Mark corrected + correction note, Feature, Pin, Commendation | | ✅ reload and public correction | `wf-controls` |
| Move to Trash, Restore, Delete Forever | ✅ own (not run) | ✅ | `wf-articles` (editor) |
| Inline review comments (select text → comment) | | ✅ create, reply, resolve, reopen, reload | `wf-lifecycle`; `publication-lifecycle` API |
| Locked after submit / publish, with explanation | ✅ | | `wf-formatting`, `wf-lifecycle` |
| Public visibility at each state | | | `wf-lifecycle`, `wf-articles`, `wf-failures` |

## 3. Editor controls (`TiptapEditor.tsx`)

All exercised in `wf-formatting.spec.ts`, then checked in editor → reopened → review preview → published page.

| Control | Editor | Reopen | Preview | Published |
|---|---|---|---|---|
| Undo, Redo | ✅ | | | |
| Print | ✅ (stubbed `window.print` was called) | | | 🚧 real print dialog |
| Bold, Italic, Underline | ✅ | ✅ | ✅ | ✅ |
| Strikethrough | ✅ | ✅ | ✅ | ✅ (fixed) |
| Text colour (palette, hex, remove) | ✅ | ✅ | | ⛔ normalized by confirmed house-style policy |
| Highlight (palette, hex, none) | ✅ | ✅ | ✅ | ✅ as site `<mark>` (colour normalized) |
| Link (apply, cancel, remove) | ✅ | ✅ | ✅ | ✅ |
| Image upload → figure, caption, credit | ✅ | ✅ | ✅ | ✅ |
| Table (grid picker; row above/below, column left/right, delete row/column) | ✅ | ✅ | ✅ | ✅ (fixed) |
| Delete table | ✅ `wf-controls` | ✅ absent | | |
| Horizontal rule | ✅ | ✅ | | ✅ |
| Bullet list, Numbered list, Indent, Outdent | ✅ | ✅ | | ✅ |
| Align left / centre / right / justify | ✅ | ✅ | | ⛔ normalized by confirmed house-style policy |
| Line spacing (4 options) | ✅ all four, `wf-controls` | ✅ | | ⛔ normalized by confirmed house-style policy |
| Block quote, Code block (⌘/Ctrl+Enter to leave) | ✅ | ✅ | ✅ pre | ✅ (code fixed) |
| Pull quote, Footnote | ✅ | ✅ | | ✅ |
| Headings (`## `, `### ` shortcut) | ✅ | ✅ | ✅ | ✅ |
| Paste with images | ✅ (synthetic paste event) | | | |
| Footnote edit/cancel/remove by clicking the marker | ✅ `wf-controls` | ✅ retained note | | |
| Tutorial dialog | ✅ open/close on a phone (`wf-mobile`) | | | |
| Dark-mode toggle in the editor bar | ✅ both directions, `wf-controls` | | | |
| Word count / reading time panel | ✅ `wf-controls` | | | |
| ⛔ Font size / font family | no control: `applyFontSize` is unused code; only reachable by pasting | | | |
| ⛔ Heading button | none; the tutorial now says so | | | |

## 4. Uploads (`wf-upload.spec.ts`)

Figure, cover from the document body, cover from the settings panel, cover URL, pasted image ✅.
Invalid file (image name, text bytes), over 10 MB, storage 500, expired session ✅, with
nothing stored on failure. Who may upload (signed out 401, reader/growth 403, unknown bucket 400) ✅.
Avatar upload: `team-profile.spec` and `tests/integration/team-profile-storage.test.ts`.
🚧 Supabase bucket policies and size/type limits on the real service.

## 5. Failure and data-protection scenarios (`wf-failures.spec.ts`)

500, 400, 403 with code, network abort, a request that never answers (15 s timeout), slow
save, edit during an in-flight save, Save draft ×2, Submit ×2, first autosave while typing,
expired session and recovery in a second tab, stale second tab (409 + keep/discard), failed
publish followed by autosave ✅. Dropped connection *during* upload and browser crash/close
with unsaved text (only the `beforeunload` warning exists) ❌.

## 6. Other portal areas

| Area | Status |
|---|---|
| Analytics tabs (Overview…Distribution) | ✅ ordinary Growth/persona: all tabs, four periods, all writer sort columns; `testing-mode` |
| Users: list, filters, actions menu (role, ban, warn, delete) | 🟡 page loads; actions ❌ browser; role email unit-tested; `team-profile-lifecycle.spec` covers role grants via UI |
| Debates (create/edit/vote), Series, Glossary, Predictions, Calendar | 🟡 load + console only; create/edit ❌ |
| Comments moderation tabs | ✅ load/tabs/stats `editorial.spec`; hide/restore ❌ |
| Subscribers search/export | ✅ ordinary Growth/persona: match/no-match and real CSV download; `testing-mode` |
| Notifications bell | 🟡 count seen; open/clear ❌ |
| Team Profile (create, edit, photo, roles, admin link) | ✅ `team-profile*.spec` — now in every run |
| Dashboard: streak cadence, commissioning brief, dismiss banners, delete draft | ❌ |
| Your Readers / Leaderboard | 🟡 load only; calculations in vitest |

## 7. Reader / public (`wf-reader.spec.ts`, `public.spec.ts`, `footnotes.spec.ts`, `network-crawl.spec.ts`)

Sign up, sign in/out, delete account, comment (min length), save/unsave article, profile tabs
(history, currently reading, saved, debate votes, comments, settings), rename ✅.
Home, category counts, article page, search + highlight, debate vote, dark mode, contact
validation, footnote popovers, link crawl ✅.
❌ Forgot/reset password end to end (email captured but link not followed), newsletter signup,
unsubscribe, share buttons, PDF export, avatar upload by a reader, reply to a comment,
report a comment, ban screen. 🚧 Google sign-in.

## 8. Browsers and screens

| | Chromium | WebKit |
|---|---|---|
| Desktop workflow specs | ✅ | ✅ |
| Phone (Pixel 7 / iPhone 14) | ✅ | ✅ |
| Layout 1100–1920 px | ✅ | ✅ |
| `public` spec | ✅ | ✅ (`public-webkit`), final production selection 32/32 |
| `footnotes` spec | ✅ | ✅ all seven controls passed in the final production main phase |
| `editorial`, `editor-scope`, `team-profile` specs | ✅ | ❌ chromium only |
| Firefox | ❌ not configured |

### Historical exploratory WebKit findings (outside the recorded feature selection)

These are historical findings from the earlier broad audit, superseded by the recorded follow-ups in [acceptance and evidence](./acceptance-and-evidence.md). Writer/editor journeys and role-menu navigation passed WebKit without collected application console errors. Public and footnote cases were re-run: all footnote controls passed; navigation passed after completing each transition and enforcing destination/Back assertions. Hosted representative journeys passed Chromium; a real Safari/complete HTTPS WebKit matrix remains not tested.

1. `public.spec` "navigating across pages throws no InvalidStateError": under WebKit on
   `http://localhost`, every Next RSC prefetch `fetch()` rejects with "due to access control
   checks" although the server answers 200 with `text/x-component`. A subsequent diagnostic
   tied these to replacing documents during outstanding hydration/prefetch fetches; the
   corrected test completes navigation and keeps strict console/error assertions.
2. `footnotes.spec` under WebKit: (a) keyboard Tab does not reach the footnote link (Safari
   skips links in the tab order unless the user enables it, so the popover is not
   keyboard-reachable there by default); (b) a tap outside the open popover does not close it
   under WebKit touch emulation; (c) a page-height equality assertion is 1 px off.
