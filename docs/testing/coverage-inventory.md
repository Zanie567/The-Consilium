# Coverage inventory

What each kind of account can open and do, and which automated test exercises it. Current appointment/testing-mode evidence and remaining limitations are in [acceptance-and-evidence.md](./acceptance-and-evidence.md); checks outside its recorded selections reflect the earlier workflow audit.

- **Observed** means the control list was read from the rendered page by `wf-roles.spec.ts`
  (run with `E2E_INVENTORY_DIR=/some/dir` to regenerate the JSON), not only from source.
- **Browser** = Playwright clicking the real control. **API/unit** = no browser.
- Status: ✅ covered · 🟡 partly · ❌ not covered · ⛔ intentionally unavailable · 🚧 blocked in the test environment.

Test files are in `tests/e2e/` unless a path says otherwise.

## 1. Accounts and who can open what

Menu per role is asserted exactly by `wf-roles.spec.ts` ("the menu is exactly the documented one"),
every entry is opened ("every menu entry opens"), and pages outside the role must be refused
("editorial pages outside the role are refused").

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

## 2. Article workflow

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
| `public` spec | ✅ | ✅ (`public-webkit`), except the view-transition test 🚧 |
| `footnotes` spec | ✅ | 🚧 3 failures under WebKit not yet triaged |
| `editorial`, `editor-scope`, `team-profile` specs | ✅ | ❌ chromium only |
| Firefox | ❌ not configured |

### Historical exploratory WebKit findings (outside the recorded feature selection)

These are retained findings from the earlier broad audit, not results of the scoped appointment/testing-mode verification. The current writer/editor journeys and actual role-menu Link navigation passed WebKit without collected application console errors. The unrelated public navigation/footnote cases below were not re-run in this implementation; an HTTPS hosted Safari check remains unavailable.

1. `public.spec` "navigating across pages throws no InvalidStateError": under WebKit on
   `http://localhost`, every Next RSC prefetch `fetch()` rejects with "due to access control
   checks" although the server answers 200 with `text/x-component`. Probably specific to
   plain-HTTP localhost; needs a check on a real HTTPS preview in Safari before it is called
   a production problem.
2. `footnotes.spec` under WebKit: (a) keyboard Tab does not reach the footnote link (Safari
   skips links in the tab order unless the user enables it, so the popover is not
   keyboard-reachable there by default); (b) a tap outside the open popover does not close it
   under WebKit touch emulation; (c) a page-height equality assertion is 1 px off.
