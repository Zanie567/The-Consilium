# Post-publication corrections: audit and design

Branch `feat/post-publication-corrections`, cut from `main` at `141cf9a` (2026-10-17). No open pull requests at the
time; the Supabase Cron scheduler (B1–B5) was finished on `main` and is not touched by this work.

## 1. Audit of what existed

| Area | What was there | Weakness |
|---|---|---|
| Data | `articles.corrected` (boolean) and `articles."correctionNote"` (one free-text note) | One note per article, overwritten on every save. No date, no author, no approver, no type, no history. |
| Review Studio | "Mark as corrected" checkbox, a note field and "Save Correction" (`ReviewPanel.tsx`) | Unconfirmed; untick-and-save silently removes the public notice. |
| Review API | `PATCH /api/editorial/articles/[id]/review`, `action: 'correct'` | Wrote the two fields directly, outside a transaction, without changing the article text and without an audit record. |
| Article editor API | `PUT /api/articles/[id]` (`PATCH` is an alias) | Accepted `corrected` / `correctionNote` from any admin or editor, and accepted any change to a **published** article's title, standfirst and body. |
| Article editor UI | Autosave every 2 s, plus save on tab hide | An editor typing in a live article rewrote it publicly within two seconds, unannounced and unrecorded. **This is the bypass that made any correction policy unenforceable.** |
| Public page | Banner "This article has been updated since its original publication" and a footnote showing the note with "Last updated: `updatedAt`" | Generic wording for a factual error; the date shown was the last edit of any kind, not the correction date. |
| Policy page | Promises senior-editor approval, a notice at the top, a dated note, no silent deletion, "the article's timestamp is updated" | None of it was enforced; "timestamp is updated" conflicted with keeping the original publication date. |
| Writers | Inline editorial comments on their own articles | A writer commenting on their own **published** article notified nobody. |

Other write paths reviewed (none changes reader-facing text of a live article): feature/pin and commendation
(metadata), calendar drag (`scheduledAt` of SCHEDULED articles only), trash and restore (`deletedAt`), the debate
lifecycle (status), scheduled publishing and its trash purge, engagement/view counters, and account deletion (hard
deletes the account's articles). Seeds and one-off scripts under `prisma/` are not runtime paths. Translations are
not merged.

Production footprint (read-only aggregate query, 2026-10-17): 29 articles, **0** with `corrected = true`, **0** stray
notes, no `article_corrections` table. The legacy migration is built and tested but is a no-op in production today.

## 2. Design

### Editorial categories

| Kind | Public result | Path |
|---|---|---|
| **Correction** | Text amended; notice at the top; dated note in **Corrections** | Manage corrections. The text *must* change (unless amending an earlier note). |
| **Clarification** | Dated note labelled *Clarification*; text change optional | Manage corrections |
| **Update** | Dated note labelled *Update*; never presented as an error | Manage corrections |
| **Minor copy edit** | No public note | Article editor → **Save changes** → confirm "minor copy edit". Recorded internally with before/after text. |

Retraction and legal takedown are deliberately **not** added. See §5.

### Data model: one table (`article_corrections`)

One row per notice. Fields: article, type, status (`PENDING` → `PUBLISHED`, or `WITHDRAWN`), public note, the internal
working record (original claim, correct information, evidence), `baseVersion` (the article fingerprint it was prepared
against), `proposed` and `previous` text snapshots (title, standfirst, body), `supersedesId` for amendments, a unique
`requestKey` (idempotency), who prepared / approved / withdrew it (id plus name snapshot, so history survives an account
deletion), and server timestamps. The existing `audit_logs` table records every step (`correction.prepared`,
`.published`, `.revised`, `.withdrawn`, `article.copy_edit`). No other table, no new dependency.

Database-enforced, not just application-enforced:

- **Permanence.** Trigger `article_corrections_protect` refuses any `UPDATE` of a `PUBLISHED` or `WITHDRAWN` row and any
  direct `DELETE` (even from the SQL console). The only removal is the cascade when the article itself is permanently
  deleted.
- **Consistency.** CHECK constraints: a non-legacy row always has a preparer, a note (1–2000 characters), a base version,
  proposed text and a request key; a published non-legacy row always has a publication time, an approver and the
  before-text snapshot; only published rows have a publication time.
- **One pending correction per article**, and **one live amendment per published notice** (partial unique indexes;
  a withdrawn amendment does not block a new one).
- RLS on, no grants to `anon` / `authenticated`.

The legacy columns are kept. Publishing a *correction* also sets `corrected = true` and copies the note into
`correctionNote`, so a rolled-back build still shows a notice.

### Atomic publication and concurrency

`src/lib/corrections/service.ts` is the only code that changes a live article's text together with a notice. In one
transaction (with the existing bounded retry for deadlocks) it:

1. locks the article row (`SELECT … FOR UPDATE`);
2. re-checks: published, not trashed, editor still in scope, the article still matches `baseVersion`, no other
   correction pending, the request key not already used;
3. writes the article text (only title, standfirst, body, and the legacy mirror; never status, dates, slug, schedule,
   flags or counters), publishes the record with the server time and the approver, and writes the audit entry.

Any failure rolls back all of it. Two editors on the same base: the second waits for the lock, then sees a different
version and gets `409 ARTICLE_CHANGED`. A double click or replay with the same key returns the first result
(`replayed: true`), never a second record. An approval echoes the pending row's `updatedAt`, so nobody approves a
version they have not seen.

After the commit (best effort, reported as warnings, never as failure): cache invalidation (`articles` tag, which
covers lists, RSS and sitemap, plus the article path), in-app notification to the author and the preparer, release of
images the correction removed. Deliberately not done: email, newsletter, "article published" notification,
achievements, change of publication date or feed position.

### Approval and the Corrections Policy

The policy promises approval by a senior editor. The roles are `ADMIN`, `EDITOR`, `WRITER`; there is no separate
Deputy Editor role. **Minimal solution implemented:** `CORRECTION_APPROVAL_ROLES = ['ADMIN']` in `src/lib/rbac.ts`.
Editors (within their categories) prepare and submit; administrators approve and publish, and may publish their own
directly (recorded as both preparer and approver). One constant changes the rule. **Decision for the
Editor-in-Chief:** confirm that "senior editor" means the administrator accounts (see the report).

### Closing the bypasses

- `PUT /api/articles/[id]`: a change to a live article's title, standfirst or body is refused
  (`409 PUBLISHED_TEXT_CHANGE_UNCLASSIFIED`) unless the request declares `editKind: 'COPY_EDIT'`; a copy edit writes
  `article.copy_edit` with before/after text in the same transaction. `corrected` / `correctionNote` are refused
  (`400 USE_CORRECTIONS_WORKFLOW`). Metadata saves, drafts and confirmed unpublishing behave as before.
- Article editor: no autosave on a live article (local recovery copy still kept); **Save changes** asks for the
  copy-edit confirmation when text changed; a live-article notice links to Manage corrections.
- Review API `action: 'correct'` answers `410 USE_CORRECTIONS_WORKFLOW`; the Review Studio shows a **Manage
  corrections** button instead of the checkbox.
- Writers: a new comment thread by the author on their own published article notifies the category's editors (or all
  editors and administrators), type `published_article_flag`.

### Reader-facing fields of a live article (review round 2)

| Field | On a live article | Why |
|---|---|---|
| Headline, standfirst, body (incl. figures and captions) | Declared copy edit (audited, before/after) or a correction | Facts and meaning live here |
| **Cover image** | Declared copy edit (audited) for the same picture improved (crop, resolution); a **correction or clarification** replaces it when the picture was wrong or misleading, atomically with the note | A wrong picture is a factual error in its own right |
| **Byline** | **Locked** (`409 PUBLISHED_BYLINE_LOCKED`); changed only through a correction, with a note | Attribution is a matter of record |
| **Web address (slug)** | **Locked** (`409 PUBLISHED_SLUG_LOCKED`); disabled in the editor; every other slug change audited (`article.slug_changed`) | Links, shares, bookmarks and search results point at it, and there is no redirect from an old slug |
| Category, topics, series, featured/pinned, commendation | Unchanged behaviour | Navigation and presentation; no change to what the article says |

Before this round, a live slug could be changed silently by any administrator or editor in scope (the editor sent it
with every save, no audit, old URL then 404s); the byline likewise; the cover image could be replaced silently.

### Rollback compatibility (review round 2)

The previous build reads only `articles.corrected` and `articles."correctionNote"`. Originally only corrections were
mirrored there, so a rollback would have hidden every clarification and update. Now every publication rewrites the
mirror with **all** published notices, oldest first, each as `Label (date): note` (`composeLegacyMirror`), and sets
`corrected = true` whenever any notice exists. Tested against the actual previous build (`main` at `141cf9a`): the
page shows the old banner and one "Correction Note" box containing every notice with its true label and date (run
together in one paragraph). Limits of the old build, documented in the runbook: its generic banner wording; its
autosave on live articles; its Review Studio checkbox overwrites the mirror (the corrections record is untouched and
the next correction after roll-forward rewrites the mirror).

### Public presentation

`src/components/article/ArticleCorrections.tsx` (server-rendered, no client JavaScript): one line near the top
("**Correction** | 16 October 2026 — This article has been corrected since it was first published. Read the note"),
using the existing `.correction-notice` style, and a **Corrections** section after the references with every
published note, oldest first, each with its own label and date (UK time), amendments linked both ways, and a link to
`/corrections`. A legacy note without a known date says "Date not recorded". The original publication date is
unchanged; `dateModified` / `og:modified_time` follow the article's `updatedAt`; JSON-LD carries `CorrectionComment`
entries. Text is rendered as React text (escaped). If the table is missing (code before migration), the page falls
back to the legacy note instead of failing.

## 3. Files

- Schema and migration: `prisma/schema.prisma`, `supabase/migrations/20261017120000_article_corrections.sql`,
  rollback `supabase/manual/20261017120000_article_corrections_rollback.sql`.
- Domain: `src/lib/corrections/{types,validation,service,public,diff,http,format}.ts`, `src/lib/rbac.ts`.
- API: `src/app/api/editorial/articles/[id]/corrections/` (`GET`/`POST`, `[correctionId]` `PATCH`, `preview` `POST`).
- Editorial UI: `src/app/editorial/(portal)/articles/[id]/corrections/page.tsx`,
  `src/components/editorial/corrections/*`, entry points in `ArticlesList`, `ReviewPanel`, the article editor.
- Public: `src/app/articles/[slug]/page.tsx`, `src/components/article/ArticleCorrections.tsx`,
  `src/app/corrections/page.tsx`.
- Bypass closures: `src/app/api/articles/[id]/route.ts`, `src/app/api/editorial/articles/[id]/review/route.ts`,
  `src/components/admin/article-editor/*`, `src/app/api/articles/[id]/comments/route.ts`.
- Deploy check: `src/lib/deploymentReadiness.ts` reports a missing `article_corrections_protect`.

### Policy accuracy (review round 3)

- "Every article ... is reviewed by an editor before publication" was not enforced: administrators and editors can
  publish their own articles. It now reads: every article is checked before publication; writers' pieces are reviewed
  and approved by an editor, and editors apply the same checks to their own work.
- The promise to explain a removal to anyone who asks is qualified by privacy, confidentiality and legal obligations.

## 4. Known limits

- **Permanent deletion removes the notices from the site.** Paths: "Delete permanently" in the trash, the automatic
  30-day trash purge, and the three account-deletion routes (which delete every article of that account, published
  ones included). The foreign key cascades so these keep working (the scheduler is unchanged); the trigger first copies
  each published notice (type, note, date, approver) into `audit_logs` as `correction.removed_with_article`, so what
  was said publicly survives internally. The policy now says a removed article's notes are removed with it.
  Residual risk: deleting a staff account deletes their published articles; that predates this work and needs its own
  decision.
- A copy edit is a declaration by the editor; the system cannot judge meaning. It is confirmed, audited with full
  before/after text and listed on the Manage corrections page.
- A slug can still be changed by unpublishing, renaming and republishing: two confirmed visibility changes, and the
  rename is audited (`article.slug_changed`, with an `everPublished` hint). No redirect from the old address exists.
- Re-publishing an unpublished article sets a new `publishedAt` (existing behaviour of the publish path).

## 5. Retraction and legal takedown: interaction and missing requirements

Not built. Today an editor can only unpublish (article disappears, URL 404s, corrections retained and shown again if
re-published) or trash it (purged after 30 days, with its corrections, which are archived to `audit_logs`). The policy
used to promise a published note explaining every removal; it now says a removed article and its notes are no longer
on the site, that the decision is explained to anyone who asks as far as privacy, confidentiality and legal obligations allow, and that a separate editor's note is published where
appropriate (an ordinary article; no tombstone at the old URL). Requirements to decide separately: who may retract; whether the URL keeps a public notice (and its
wording) or returns 410; whether the text is retained internally under legal hold (and excluded from the trash purge);
how search engines, RSS and the sitemap treat it; whether corrections remain visible on a tombstone.
