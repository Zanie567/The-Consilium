# The Consilium: Comprehensive Website Completion, Editorial Tooling and QA Pass

## Authority and scope

This is the complete normative product specification for the platform upgrade supplied by the project owner on 2026-10-06. Requirements below retain the original acceptance criteria, safety rules and conditional scope. Repeated requirements are consolidated for readability; none are waived by status, audit findings, architecture decisions or a passing foundation suite. `MASTER-STATUS.md` and workstream status files describe evidence, not acceptance criteria. Any change to these requirements requires an explicit owner decision recorded here.

The current assignment is **foundation only**: audit the repository, establish shared architecture and contracts, implement only necessary shared groundwork, verify and commit on `feature/consilium-platform-upgrade`. The later specialist implementation must satisfy this entire specification. Foundation completion is not platform-upgrade completion.

## Operating principles

Act as a staff-level senior full-stack software engineer, product engineer, database engineer, UX engineer and QA lead. Bring this serious publishing platform to production-ready standards: editors, writers, Growth & Comms and readers must work without workarounds, broken controls, confusing behaviour, data corruption, inconsistent formatting or obvious edge-case failures. Make features correct within the existing architecture; preserve working behaviour, find hidden interactions, test them and improve maintainability and safety.

Before implementation, inspect the codebase, data model, authentication and roles, editor, rendering, caching/revalidation, public pages, team profiles, search, newsletter, analytics, tests and deployment configuration. Understand existing systems; do not duplicate them. Reuse sound abstractions and conventions. No large rewrite unless existing architecture makes required behaviour impossible or unsafe.

Preserve article submission, review, scheduling, publishing, unpublishing, deletion/restoration, author and tag pages, authentication, role permissions, team profiles, notifications, caching/revalidation, existing public URLs and published content.

Work on a dedicated branch. Never push to main, push this candidate, merge, deploy to production, apply production migrations, alter production data or content, disable safety guards, reset unrelated work, or overwrite someone else's uncommitted work. Never point any test suite at production Supabase. Respect existing test-database safety protections without bypasses. Schema changes require proper migrations tested only on a safe test/development database. Release is a separate owner decision even after all checks pass.

Do not weaken coverage to get green results. Do not delete or skip tests unless demonstrably obsolete and clearly explained. Do not shortcut with `any`, unsafe assertions or error suppression without specific justification. Never invent credentials, URLs, database values, external service IDs or configuration. If a real value (for example LinkedIn) cannot be found in the repository or existing settings, make it configurable and report the required value.

For every user-facing feature consider loading, success, empty state, validation failure, server failure, unauthorised access, slow connection, repeated submission, mobile and desktop. Prove functionality with automated tests and browser testing where appropriate; code inspection alone is not proof.

## Product context and primary goal

The Consilium is a student economics publication with readers, writers, editors, leadership, Growth & Comms, public team profiles and editorial publishing tools. Long-term operation should be largely self-service: writers write; editors edit and schedule; Growth & Comms manage profiles and ultimately analytics; leadership need not repair routine website issues.

The site should feel like a coherent publication. Preserve its established visual language and good overall design. This is not a whole-site redesign; improve functionality and polish without unnecessary visual complexity.

Complete and properly test all of: article categories and topic tags; multi-select filtering; search across articles, authors and topics; rich formatting; tables; figures; images; charts; captions; credits; sources; annotations/notes; Google Docs paste; team hierarchy; Growth & Comms profiles; LinkedIn; newsletter; article sharing; readership analytics; relevant admin/Growth tooling; mobile; accessibility; errors; caching/revalidation; regression coverage. These must work together.

## Phase 1 — Audit before implementation

Before touching implementation code, inspect and produce a concise implementation plan covering:

- Framework/version and routing structure.
- Database ORM/schema, Supabase, Supabase Storage, migration workflow and environment-variable handling.
- Authentication provider, role model, profiles and articles.
- Editor architecture, HTML/rich-text storage, sanitation pipeline and public article rendering.
- Publication state machine, cache strategy and route revalidation.
- Search, tags, newsletter, analytics and image upload.
- Test infrastructure, Playwright, integration and component coverage.

Trace and preserve the complete lifecycle: writer creates → edits → submits → editor reviews → edits → schedules/publishes → public article appears under correct author/tags → later editing, unpublishing, deletion and restoration.

## Phase 2 — Article information architecture

### Format/category

Formats describe the kind of piece: **News**, **Opinion**, **Analysis** initially. Keep deliberately simple; do not invent dozens. One primary format per article. Future extension must not require a data-model redesign. Adapt sound existing category architecture.

### Topic tags

Tags describe subject matter. Illustrative examples: Politics, International Relations, Investment & Finance, Sustainability, History, Macroeconomics, Development, Energy. They are examples, not mandatory seeded taxonomy. Do not hard-code an excessive taxonomy. Support roughly 5–10 meaningful tags initially; editors normally assign 1–3 tags per article.

Prevent duplicates from capitalisation/whitespace (`Finance` and ` finance ` are the same). Use canonical slugs: `Investment & Finance` → `investment-finance`; `International Relations` → `international-relations`. Renaming must not silently break article relationships or URLs. Deletion needs safeguards for in-use tags.

### Public navigation

Keep navigation clean: Home/all current content and clear access to News, Opinion, Analysis. Topic discovery should mainly use filtering, search and links, not dozens of permanent top-level items. Adapt existing presentation without unnecessary redesign.

### Multi-select filtering

Readers can select several topics (e.g. Politics + History, Investment & Finance + Sustainability). Define/document logic; OR (match any selected tag) is the sensible default unless the existing UI clearly suggests AND, which must be assessed first.

Filters must update without full-page failure, combine correctly with pagination/sorting and formats, work on mobile and keyboard, show selected state, allow individual removal and clear-all, handle zero results, preserve useful URL/shareable query state where practical, and never duplicate articles. Keep controls usable as the tag list grows.

### Search

Audit and extend existing search. Discover article titles, body/excerpt where reasonable, authors and topic tags. `Bank of England` finds relevant articles; an author name finds that author and/or their articles; `finance` finds the related topic and articles. Clearly distinguish result types where appropriate and avoid duplicate/confusing cards.

Handle empty/whitespace queries, partial matches, no results, keyboard submission, mobile, loading, server errors and pagination where needed. Avoid costly database queries on each keystroke; debounce or provide an appropriate alternative.

## Phase 3 — Editor and rich content

Audit and exercise every existing control. A rendered toolbar button is not evidence of working behaviour. Formatting must survive save, autosave where present, submission, editorial editing, scheduling, publishing, reopening and republishing.

Properly test existing paragraphs, headings, bold, italics, links, blockquotes, ordered/unordered lists, images, figures, tables, captions, horizontal separators and alignment where supported, undo and redo. Fix controls that do nothing or behave inconsistently; remove only genuinely obsolete controls. Never leave fake controls.

### Google Docs paste (priority)

Writers frequently paste Google Docs drafts. Test realistic clipboard HTML. Convert paragraphs, headings, bold, italics, links, numbered/bullet lists and tables sensibly. Strip irrelevant Google markup and inline styling rather than preserving hundreds of styles. Sanitize unsafe content: no scripts, event handlers, unsafe embeds, `javascript:` URLs, malicious HTML or unwanted tracking content. Unsupported formatting must degrade gracefully without corruption. Plain-text paste must continue working.

### Tables

Resolve the known Google Docs table-rendering issue completely. Readers/authors must be able to paste a Google Docs table; create one if native insertion is supported; edit cells and inline formatting where supported; add/remove rows/columns; delete a table; navigate cells sensibly; save/reopen without loss; submit; have an editor edit; publish; and see the correct public structure. Expose header rows if supported by the framework.

Tables must suit the publication design: readable type and restrained borders rather than unnecessary spreadsheet styling. On narrow screens, contain horizontal scrolling when needed; no page-wide overflow or unreadable text shrinking.

Where sensible in existing architecture, attach optional caption/title, source, source URL and note/annotation to the table. Example: `Table 1. UK inflation by year`, table, `Source: Office for National Statistics`, `Note: Values rounded to one decimal place.` No mandatory irrelevant fields or blank labels. Render URLs safely.

### Figures/images

Use consistent structured figures, not unstructured image HTML. The editor must manage image file, alternative text, caption, credit, source, source URL, note/annotation, replacement and deletion. Metadata is optional where irrelevant.

Alt text: support it; encourage or require useful alt text for meaningful images before publication; explicitly mark decorative images if architecture permits; never use the filename as automatic alt text.

Caption example: `UK CPI inflation, 2015 to 2026.` Credit examples: `Photo: Jane Smith`, `Chart: The Consilium`. Source example: `Source: Bank of England`, with optional source URL. Note example: `Note: Forecast values begin in 2027.` Keep metadata attached to its figure; render predictably with no empty `Credit:`/other labels.

### Upload safety

Audit/reuse safe storage, including established Supabase buckets/permissions if present. Validate actual MIME/content, size, failures, cancellation, duplicate uploads and invalid files; extension alone is insufficient. Do not expose writable public storage if existing storage is private/signed. Preserve published image URLs. Avoid orphan objects during replacement/permanent article deletion; never delete images referenced elsewhere.

### Charts and display

Minimum dependable chart path: create externally → export image → upload figure → alt text → caption → source → optional note. Test richer embeds if already present. No large custom chart builder without an existing one or compelling reason; dependable publishing takes precedence over bloat.

If suitable, offer a small layout set such as standard content width, wide, centred; no dozens of arbitrary controls. Safe mobile fallback, maintained aspect ratio and practical layout-shift prevention through dimensions/framework image optimisation.

### Rendering consistency and security

Preview and public article must not radically differ. Verify headings, paragraph spacing, table structure, figure metadata, correct caption/credit/note attachment, clickable links, real lists, and preservation through review, scheduling and republishing. Dangerous raw HTML must never bypass sanitation.

## Phase 4 — Meet the Team

Retain the pyramidal structure:

1. **Editor-in-Chief**: single centred top card, visibly distinguished. Routine role/profile operations must not displace this person accidentally.
2. **Deputy Editors-in-Chief**: two cards on desktop below the chief; graceful mobile stacking and no awkward empty gap if only one profile exists.
3. **Editorial Team**: exact section heading, editor profiles.
4. **Writers**: exact heading, writer profiles.
5. **Growth & Comms**: exact heading, Growth & Comms profiles.

### Profile permissions

Audit existing management. At most one active self-profile unless intentional existing semantics differ. Section derives from account role/team; users cannot choose arbitrary placement. Growth & Comms must create/manage their own profile like writers/editors: open management, create, upload/select photo via established mechanism, name if editable, bio, save/edit/reload, correct assignment and public appearance. Prevent duplicate profiles, impersonation, self-appointment as chief/deputy, and team reassignment without administrative authority. Preserve legitimate admin/leadership management and writer/editor self-management.

### Ordering, empty states, responsiveness

Deterministic chief → deputies → editorial → writers → Growth order. Preserve legitimate explicit ordering; otherwise predictable fallback, never database return order. Hide ugly empty sections; prefer hiding Growth heading until profiles exist if consistent with current design. Clearly tell eligible members without profiles how to create one.

Desktop: chief centred, two deputies beneath, wider member rows. Tablet/mobile: graceful readable stacking without literal pyramid gaps/tiny cards. Correct image crop; no overflowing names/roles.

## Phase 5 — LinkedIn

Fix generic LinkedIn destination. Audit all social-link instances and current storage. Prefer one source of truth: existing site settings, database config or established environment/config pattern. Do not duplicate hard-coded URLs. Never invent the publication page. Use an existing real value if present; otherwise create configurable setting and report that the owner must supply it before production release. Working desktop/mobile, safe external links and accessible label are required. Check every instance, not only footer.

## Phase 6 — Newsletter

Make Subscribe real using `email_subscribers` or suitable existing equivalent. Reader enters email → submits → sees clear success. Repeated same-address submissions must not create duplicate rows.

Handle invalid email, whitespace, case duplicates, already subscribed, server/network failure, repeated clicks, loading and slow requests. Normalize appropriately. Do not expose other subscribers' sensitive information or internal DB errors; use friendly public messages. Preserve unsubscribe, confirmation/double opt-in if present; do not invent a provider.

## Phase 7 — Sharing

Audit every public article share control; each must work. Where part of the design, provide sensible copy link, LinkedIn, email and compatible native mobile Web Share. Remove dead controls for unsupported networks.

Copy correct canonical URL, acknowledge success and handle denied/failed clipboard access gracefully. LinkedIn uses correctly encoded URL. When production origin is known, never inadvertently share localhost, preview or Vercel deployment URLs.

## Phase 8 — Analytics

Audit/extend existing architecture; no competing system without necessity. Desired metrics: views, engaged reading time, readers spending approximately five active minutes, returning readers, article performance over time, with later author/tag/format comparisons possible.

Five-minute metric measures active reading, never merely an open tab. Where practical pause while hidden/inactive, resume when active; heartbeat/events must avoid excessive requests. No invasive fingerprinting or unnecessary personal data. Respect privacy/consent. Do not silently introduce persistent browser IDs/cookies requiring consent without accounting for it. Prefer privacy-preserving returning-reader definition. Document metric calculations precisely.

Extend existing Growth/admin analytics UI. Useful displays: total views, engaged reads, average active time, returning readership, most read/highest engagement. Avoid misleading precision; label approximations. Ordinary public users/writers must not access restricted analytics beyond current intended rules. Give/retain Growth access only within intended permissions, without accidental broadening.

## Phase 9 — Caching/revalidation

Audit affected cached pages and warming/revalidation. Changes to format, tags, title, slug, author, publication state, team profile/role, settings and LinkedIn must update/invalidate appropriate public surfaces. Database-only fixes leaving stale pages are unacceptable.

Potential surfaces: home, all articles, News/Opinion/Analysis, article, author, tag, team, cached search/indexes. Verify publish, unpublish, republish, edit, delete and restore wherever relevant.

## Phase 10 — Accessibility

Correctness includes keyboard navigation, visible focus, named buttons/icon controls, form labels, validation messages, heading hierarchy, alt text, semantic tables, contrast where changed, modal focus and Escape where appropriate. Semantic buttons instead of clickable divs. Do not remove focus outlines without replacement.

## Phase 11 — Mobile/responsive QA

Inspect approximately 375px, 768px and 1440px. Pay particular attention to editor toolbar, formatting dialogs, table overflow, figures/captions/credits, search, filters, team pyramid/cards, newsletter and shares. No horizontal page overflow from changes.

## Phase 12 — Errors

Every introduced/modified async operation has explicit failure behaviour. Profile saves, uploads, article saves, newsletter, analytics and tag updates cannot fail silently or remain stuck loading. Avoid destructive optimistic updates without correct rollback. Protect double submits.

## Phase 13 — Database quality

Only change schema where existing structure demonstrably cannot support a feature cleanly. Inspect format, tags/join table, metadata, team roles, settings and analytics; do not assume all need tables/columns.

Migrations must be proper, deterministic, safe for existing rows, constrained/indexed for actual queries, preserve production semantics, document rollback and be tested safely. Never run production migrations. Prefer DB-enforced invariants where appropriate: unique slug, one self-profile, valid FKs, appropriate cascade/restrict and filtering/join indexes. No cascades unexpectedly deleting published content.

## Phase 14 — Security

Audit new server actions/routes/mutations. Verify authentication/role permissions on the server; no Growth or writer escalation; no editing another person's profile without authority; no public content mutation; sanitize HTML and relevant URLs; validate uploads; preserve DB policies. Hidden UI is not access control.

## Phase 15 — Testing strategy

Meaningful automation in existing stack is required. Do not introduce parallel frameworks unnecessarily.

### Unit/component coverage

Cover tag normalization/slug behaviour/selection; email normalization/duplicate newsletter handling; role-to-team mapping/team order; figure metadata validation; active-time logic where applicable; relevant UI states.

### Integration coverage

Safe database only: article/tag relationships, uniqueness, profile uniqueness, Growth permissions, newsletter persistence, analytics persistence and every new migration.

### Playwright workflows

- **Writer** signs in, creates article, title/body, formatting, link, list, realistic Google Docs HTML/table paste, figure upload, alt/caption/credit/source/note, save/reload with everything intact, submit.
- **Editor** signs in, pending article and formatting, text/table editing, tags confirmation/change, metadata inspection, schedules/publishes, correct public output.
- **Public article** title, author, format/tags, paragraphs/headings/lists/links, tables, figures/images, alt in DOM, caption/credit/source/note and shares.
- **Filtering** one tag, correct matches; second tag, defined matching logic; clear; URL reload/share if URL-backed.
- **Search** title, topic, author and no results.
- **Team** chief top, deputies next, Editorial Team, Writers, Growth & Comms, mobile.
- **Growth** sign in, create/edit/reload persistence, one profile, proper public section, rejected unauthorised role change.
- **Newsletter** valid/invalid/repeat email, loading/success/mocked API failure.
- **Links** LinkedIn destination, copy and every other share.
- **Analytics** hidden state pauses active time and engagement persists correctly where testable.

### Mandatory Google Docs table regression

Realistic clipboard fixture: three columns, header, bold and linked content, multiple rows. Paste with Playwright clipboard or editor-level test. Prove creation, all cells, correct row/column counts, preserved text/valid links, stripped unsafe Google markup, save/reopen/publish and public table structure.

### Mandatory figure regression

Test upload → preview → metadata → save → reload → review → publish → public render. Test replacement/deletion; confirm unrelated images remain.

### Mandatory team regression

Mixed fixture: one chief, two deputies, several editors, writers and Growth members. Randomized database/insertion order must render chief → deputies → Editorial Team → Writers → Growth & Comms.

### Existing suite and visual QA

After targeted tests, run whole existing suite: typecheck, ESLint, unit, integration, Playwright and production build. Do not run only new tests; breaking existing workflow is failure.

Launch locally after automation. Actually interact on desktop/mobile: formatting controls and dialogs, tag selection/removal, table editing, every team tier, newsletter submit, shares. Inspect console for errors, hydration warnings, React errors, failed requests and page overflow. Initial screenshots alone are insufficient.

## Performance and SEO

Avoid severe regressions, especially search/filter/list/team queries, analytics requests and images. Avoid N+1 queries; index real access patterns. Do not load all article bodies for homepage cards unless existing architecture genuinely requires it. Optimize images appropriately.

Preserve SEO titles, excerpt/description, canonical URL, existing author/social metadata and tag-page indexing strategy. Filter combinations must not create hundreds of indexed duplicate pages.

## Scope control and implementation sequence

Do not rebuild auth, entire dashboard/homepage/design or publication pipeline without a genuine blocker. Document unrelated bugs; fix only small/directly relevant/dangerous ones; list others separately.

Safe sequence: audit → necessary domain model groundwork → topics/formats → editor/tables/figures → public rendering → team/Growth → social/newsletter/shares → analytics → caching → tests → complete regression → interactive browser QA. Do not implement all simultaneously without intermediate verification.

For this foundation assignment, partition later implementation into Discovery, Editor, Figures, Team, Growth integrations and Analytics. Establish stable shared contracts, shared-file ownership, exact migration ownership and isolated branches/worktrees from a verified foundation commit; specialists must not share this working directory. Do not implement these feature sets now.

## Definition of done (entire upgrade)

Every item below is required before calling the platform upgrade complete:

- Successful build, typecheck, lint, existing tests and new tests.
- Submission, review, publishing and scheduling preserved.
- Google Docs tables work, persist after save/reload and render publicly.
- Figures, images, captions, credits, sources and notes work.
- Links/lists and formatting survive complete publication lifecycle.
- Topic tags, multiple filters and search work.
- Team ordering and Growth profiles work; Growth cannot escalate.
- Correct configurable LinkedIn destination.
- Newsletter stores/processes subscriptions with duplicate handling.
- Share controls work.
- Analytics matches documented calculations/privacy behaviour.
- Mobile works without obvious overflow, console errors or hydration warnings.
- No test connects to production; no production DB/content change, migration or deployment.

## Final adversarial review

Before reporting upgrade completion, repair relevant issues found by considering: what still breaks; double clicks; failed DB requests; empty fields; extremely long captions/URLs; mobile/wide tables; unusual Google Docs paste; interrupted uploads; multiple figures; writer edits after submission; post-publish tag changes; unpublishing; deleted author accounts; Growth without profile; only one deputy; existing subscription; denied clipboard; failed analytics requests. Happy-path success is insufficient.

## Final implementation report required after specialist integration

Provide these exact areas, candidly distinguishing unverified/incomplete work:

1. Implementation summary: exactly what changed.
2. Article editor: formatting, Google Docs, tables, figures/images, captions/credits/sources/notes, links/lists.
3. Categories/tags/search: final behaviour/model.
4. Team: hierarchy and Growth profile behaviour.
5. Newsletter/LinkedIn/sharing: actual connections/tests.
6. Analytics: metrics/calculations/privacy.
7. Database: every migration/schema change, whether applied anywhere.
8. Tests added: what each proves.
9. Complete verification: actual typecheck/lint/unit/integration/Playwright/build results and counts; never only “all pass”.
10. Manual/browser QA: actual pages/interactions.
11. Remaining risks/blockers: no false completion claim.
12. Git: branch, hashes, clean/dirty tree and whether pushed/deployed/production changed.

Foundation report instead must give branch, foundation commit, schema decisions, article/tag and rich-content contracts, roles, analytics extension point, shared files, workstream boundaries, baseline evidence and blockers before parallel work.

## Release rule

**Never push, merge, deploy, run production migrations or alter production data.** Stop with the completed/tested local candidate and report; the owner separately controls release. The desired result is dependable publishing that writers, editors and Growth & Comms can use without routine leadership intervention.
