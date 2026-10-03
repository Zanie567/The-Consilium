# Coverage inventory

What each kind of account can open and do, and which automated test exercises it.

- **Observed** means the control list was read from the rendered page by `wf-roles.spec.ts`
  (run with `E2E_INVENTORY_DIR=/some/dir` to regenerate the JSON), not only from source.
- **Browser** = Playwright clicking the real control. **API/unit** = no browser.
- Status below describes tests that exist, not an unconditional passing claim. See workflow-audit-report.md for executed outcomes. ✅ covered · 🟡 partly · ❌ not covered · ⛔ intentionally unavailable · 🚧 blocked in the test environment.

Test files are in `tests/e2e/` unless a path says otherwise.

## 1. Accounts and who can open what

Menu per role is asserted exactly by `wf-roles.spec.ts` ("the menu is exactly the documented one"),
every entry is opened ("every menu entry opens"), and pages outside the role must be refused
("editorial pages outside the role are refused").

| Page | Writer | Editor | Admin | Growth | Reader |
|---|---|---|---|---|---|
| Dashboard `/editorial` | ✅ | ✅ | ✅ | ✅ | ⛔ Access Denied |
| Team Profile | ✅ | ✅ | explanation only | ✅ | ⛔ |
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

## 2. Article workflow

| Action | Writer | Editor/Admin | Test |
|---|---|---|---|
| Create, autosave, Save draft | ✅ | ✅ | `wf-lifecycle`, `wf-failures`, `editorial.spec` (autosave + reopen) |
| Title, excerpt, category, tags, cover URL | ✅ | ✅ | `wf-formatting`, `wf-upload`, `wf-mobile` |
| Slug, author, status dropdown | ⛔ hidden | ✅ slug/author/status save, reopen, publish and schedule | `wf-controls` |
| Submit for review | ✅ | n/a | `wf-lifecycle`, `wf-formatting`, `wf-mobile` |
| Editor notified (email captured + in-app) | | ✅ email; 🟡 in-app bell not clicked | `wf-lifecycle` |
| Internal note on review screen | | ✅ | `wf-lifecycle` |
| Return to writer with feedback | | ✅ | `wf-lifecycle` (button disabled without text; email carries the note) |
| Writer sees feedback, revises, resubmits | ✅ | | `wf-lifecycle` (note cleared on resubmit) |
| Publish Now (review screen) | | ✅ | `wf-lifecycle`, `wf-formatting`, `wf-mobile` |
| Schedule (review screen) | | ✅ future time; scheduler publishes | `wf-lifecycle` (cron call is a fixture) |
| Unpublish (review screen) | | ✅ | `wf-lifecycle` |
| Publish / Unpublish from the article list | | ✅ | `wf-articles` |
| Publish / Schedule / Unpublish buttons inside the editor | | ✅ success + failure, View live, reopen status | `wf-controls`, `wf-failures` |
| Mark corrected + correction note, Feature, Pin, Commendation | | ✅ | `wf-controls` |
| Move to Trash, Restore, Delete Forever | ✅ own (not run) | ✅ | `wf-articles` (editor) |
| Inline review comments (select text → comment) | | ❌ browser; API 🟡 | `publication-lifecycle.spec` (API only) |
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
| Text colour (palette, hex, remove) | ✅ | ✅ | | ⛔ stripped by decision |
| Highlight (palette, hex, none) | ✅ | ✅ | ✅ | ✅ as site `<mark>` (colour not kept) |
| Link (apply, cancel, remove) | ✅ | ✅ | ✅ | ✅ |
| Image upload → figure, caption, credit | ✅ | ✅ | ✅ | ✅ |
| Table (grid picker; row above/below, column left/right, delete row/column) | ✅ | ✅ | ✅ | ✅ (fixed) |
| Delete table | ✅ `wf-controls` | ✅ | | | |
| Horizontal rule | ✅ | ✅ | | ✅ |
| Bullet list, Numbered list, Indent, Outdent | ✅ | ✅ | | ✅ |
| Align left / centre / right / justify | ✅ | ✅ | | ⛔ stripped by decision |
| Line spacing (4 options) | ✅ all four `wf-controls` | ✅ | | ⛔ stripped by decision |
| Block quote, Code block (⌘/Ctrl+Enter to leave) | ✅ | ✅ | ✅ pre | ✅ (code fixed) |
| Pull quote, Footnote | ✅ | ✅ | | ✅ |
| Headings (`## `, `### ` shortcut) | ✅ | ✅ | ✅ | ✅ |
| Paste with images | ✅ (synthetic paste event) | | | |
| Footnote edit/remove by clicking the marker | ✅ edit/cancel/remove `wf-controls` | ✅ | | | |
| Tutorial dialog | ✅ open/close on a phone (`wf-mobile`) | | | |
| Dark-mode toggle in the editor bar | ✅ `wf-controls` | | | |
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
publish followed by autosave ✅. Dropped connection during upload + retry/reopen ✅ `wf-upload`. Back to articles failed-save/retry ✅ `wf-failures`. Browser crash/close with unsaved text ❌: only the `beforeunload` warning exists.

## 6. Other portal areas

| Area | Status |
|---|---|
| Analytics tabs (Overview…Distribution) | ✅ load + Writers data `editorial.spec`; filters/range ❌ |
| Users: list, filters, actions menu (role, ban, warn, delete) | 🟡 page loads; actions ❌ browser; role email unit-tested; `team-profile-lifecycle.spec` covers role grants via UI |
| Debates (create/edit/vote), Series, Glossary, Predictions, Calendar | 🟡 load + console only; create/edit ❌ |
| Comments moderation tabs | ✅ load/tabs/stats `editorial.spec`; hide/restore ❌ |
| Subscribers search/export | 🟡 page loads; export ❌ |
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
| `public` spec | ✅ | configured including the view-transition check; see run report |
| `footnotes` spec | ✅ | enabled; keyboard/outside tap corrected, intermittent height issue open |
| `editorial`, `editor-scope`, `team-profile` specs | ✅ | ❌ chromium only |
| Firefox | ❌ not configured |

### Open WebKit findings (not fixed, not hidden)

1. `public.spec` "navigating across pages throws no InvalidStateError": under WebKit on
   `http://localhost`, every Next RSC prefetch `fetch()` rejects with "due to access control
   checks" although the server answers 200 with `text/x-component`. Probably specific to
   plain-HTTP localhost; needs a check on a real HTTPS preview in Safari before it is called
   a production problem.
2. Historical `footnotes.spec` findings under WebKit (the keyboard and outside-point tests have now been corrected; the exact page-height assertion remains enabled): (a) keyboard Tab does not reach the footnote link (Safari
   skips links in the tab order unless the user enables it, so the popover is not
   keyboard-reachable there by default); (b) a tap outside the open popover does not close it
   under WebKit touch emulation; (c) a page-height equality assertion is 1 px off.

## 9. Full source census and stateful controls

[control-inventory.json](./control-inventory.json) lists every discovered JSX control
declaration and native dialog, linked to all page routes through inherited layouts and
component imports. Options and dynamic map expressions are included. Each entry records
its source line, expected handler/navigation, disabled condition and candidate test
references. A candidate reference is never a claim that an action ran. Rendered snapshots
under `test-results/inventory/<browser>/<role>.json` record the initial portal pages; they
do not enumerate dialogs that have not been opened. Data-dependent rows are families
(one action per article/user/debate), not a finite list of production data.

| Stateful control family | Expected behaviour | Browser coverage / gap |
|---|---|---|
| Writer/Editor/Admin/Growth sidebar; mobile drawer; sign out | exact role menu, route access, scroll-bounded shell, sign out | `wf-roles`, `editorial-layout`, reader sign out; portal sign out action not separately tested |
| Article filters/search/sort/pagination, My Drafts, article action menu | scope rows to role/status/query; Edit/Review/View/Publish/Unpublish/Trash | page access + lifecycle/list publication/trash tested; every filter combination/pagination uncovered |
| Editor colour/highlight menus | palette swatches, hex Enter, remove/no highlight; cancel closes | representative swatches + hex + remove in `wf-formatting`; every individual swatch equivalent not separately clicked |
| Table picker/context menu | 1–10 columns, 1–8 rows; insert/delete rows, columns, whole table | representative 3x3 and 2x2 + all context actions; all 80 dimensions not separately tested |
| Link bar, figure/caption/credit inputs, footnote prompt, upload chooser | apply/cancel/remove; save content and uploads; edit/cancel/remove footnotes | `wf-formatting`, `wf-controls`, `wf-upload`; native OS chooser/print dialog blocked by automation |
| Settings desktop aside/mobile sheet, tutorial dialog | categories/tags/slug/author/status/date/cover; close settings/tutorial | `wf-formatting`, `wf-controls`, `wf-mobile`; series assignment and tag removal uncovered |
| Save conflict banner, expired-session error, beforeunload confirmation | keep/discard, recover login, preserve content, warn before closing | save conflict and recovery tested; actual crash recovery uncovered |
| Review feedback/correction/commendation and feature/pin | disabled return without text; persist state; public correction; feature/pin toggle | `wf-lifecycle`, `wf-controls`; selected-text inline review comments uncovered |
| Trash confirmation | restore or permanently delete only authorised articles | `wf-articles` editor; writer-own trash action not exercised |
| Users filters, row menu, user details, ban/warn/delete confirmation | Admin manages users; role change updates access and profile | Team Profile lifecycle role grants covered; ban/warn/delete and remaining filters uncovered |
| Team Profile + admin Team management forms/link selector/delete confirmation | own biography/photo, duplicate protection, legacy card link, public roster | `team-profile*.spec`; exact run outcome in report |
| Analytics Overview/Articles/Categories/Authors/Readers/Activity/Writers/Distribution tabs and date/filter controls | valid data for Admin/Growth, deny other roles | tab load + Writers data; date/filter interactions uncovered |
| Debates create/edit/delete/results/export, glossary form/import/toggle, predictions create/edit/resolve/cancel | authorised state changes; validation; public visibility | page/navigation/role checks and API/unit checks only; creation/edit browser actions uncovered |
| Series form/order/parts; calendar month/event/filter/form | save series/calendar for authorised roles | menu load only; mutations uncovered; calendar intentionally Admin only |
| Growth subscriber search/filter/export, engagement/writer metrics, reader-author selector | scoped reports/export, correct aggregations | initial page + unit/integration data checks; browser export/filter actions uncovered |
| Dashboard commissioning brief, cadence, achievement/banner dismiss, draft delete, notification bell/open/clear | persist authorised edits, dismiss/read relevant notices | uncovered UI actions; APIs/calculations partly unit-tested |
| Public header/search/mobile menu, cookie consent/theme, category/archive/tag/author pagination | navigate/filter/read without internal errors | public/network-crawl + mobile + reader flows; not every data-dependent pagination path |
| Article share/copy/PDF, bookmarks, footnotes, comments/reply/report | copy/share/save, decode notes, submit/moderate authorised comments | bookmarks/comments/footnotes + share control presence; external share, PDF, reply/report uncovered |
| Login/signup/profile tabs/settings/delete account; password reset forms | session transitions, rename, save/history/votes/comments, deletion | `wf-reader`; forgot/reset full captured-link flow uncovered; Google intentionally off in tests |
| Newsletter/unsubscribe/contact/ban screen | validate forms, persist consent/disable subscription, display ban | contact empty validation only; newsletter/unsubscribe/ban outcome uncovered |
| Legacy `/admin` pages | redirects to portal, Team management Admin only; legacy data deletion form API protected | Team covered; data/login-attempts/subscribers legacy UI uncovered; inspect API permissions separately |
| `/editorial/setup` | first Admin form only if no Admin exists | intentionally unavailable in seeded app; route-handler test creates first Admin in process |
| `/predictions`, detail and leaderboard | Admin-only trial; others refused | intentionally disabled for non-Admin; public prediction browser actions uncovered |
| About/team/corrections/privacy/terms | read static/public content and published corrections/roster | crawl/page tests; correction content and Team roster workflows covered |

Published typography policy is already recorded in
`tests/unit/article-render-formatting.test.ts`: preserve semantic tables/strike/code, use
house style for colours/alignment/line spacing/fonts. The audit preserves that policy.
Font family/size have no available toolbar control; dormant callbacks/pasted attributes
are inspection findings. This is not new owner confirmation in this session.
