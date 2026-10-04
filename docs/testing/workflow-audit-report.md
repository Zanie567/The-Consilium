# Workflow audit completion — verification in progress

This branch continues the preserved audit on a dedicated worktree, incorporating its changes against `origin/main` without modifying the original checkout or other active audits. The task branch is `fix/workflow-audit-completion`. The owner confirmed **preserve editor styling on publication**; the renderer preserves validated colours, highlights, alignment, spacing and table widths alongside semantic content.

The final full verification is being moved to GitHub Actions because other local audits and the owner's laptop work produced system load above 100. Cloud Chromium/Playwright WebKit and mobile emulations are independent of those local resources. This draft report will be replaced with the exact cloud commit, results and artifact links when that run completes. It does not claim a final green result.

## Executed evidence so far

The previous complete local run used one clean commit, `497785c19652ccd63a30d4bc78b452d8f12f69d5`, and fresh resources `next-e2e-3357-66419`. Vitest: **965 passed, 1 failed**; main browser phase: **73 passed, 11 failed**; workflows: **348 passed, 4 failed**; Team Profile: **41 passed**. Total browser executions: **462 passed, 15 failed, 0 skipped**, including repeated setup executions between phases. These results predate subsequent fixes and are historical evidence only. Artifacts remain in `test-results/next-e2e-3357-66419/` and `playwright-report/next-e2e-3357-66419/` in the task worktree.

The failures identified a cold local-image request/cache hang, an obsolete console-collector expectation, a wrong negative permission status, a prediction refresh/navigation race and the retained strict WebKit document-navigation errors. Subsequent ordinary unit/route tests passed **793/793**, and focused account-data/image regressions passed **12/12**. Those focused passes are not combined with historical browser passes into a final result.

## Confirmed fixes

- Owner/account-scoped local draft recovery across refresh, closure and browser restart; explicit recovery decisions, stale-server conflicts, deliberate overwrites, deleted/missing/expired article handling and local download/discard. Recovery never submits, approves or publishes. Pending recovery locks body, title, excerpt, cover and metadata controls.
- Exact save response assertions, edits during in-flight saves, timeouts and retries without silently losing unsaved work; fresh persisted content assertions.
- Explicit confirmation and API intent for publication changes; ordinary metadata saves cannot accidentally publish/unpublish/schedule. Repeated/cancelled destructive actions and warmed public-cache visibility have browser regressions.
- Fresh database session permissions, current ban/active/role enforcement, owner/category trash boundaries and deleted-article refusal.
- Atomic one-use password-reset claims and controlled captured-link browser workflows; production email and OAuth are disabled in tests.
- Browser/server 4 MiB upload limits, interrupted/invalid upload recovery and reader avatar persistence.
- Private admin profile notes and account metadata gated before data access; category assignments validate before an atomic profile update. Invalid/missing debate updates cannot deactivate another debate. In-process regression baseline: 8 failures/3 passes; after fixes: 11 passes.
- Failed admin profile, warning, note, user-detail and audit requests retain input and expose retry/error controls. New browser checks await cloud execution.
- Content-filter expected failures replaced by active passing regressions; editor formatting policy implemented with a restrictive CSS sanitizer, not arbitrary style passthrough.
- Clipboard failure feedback, dashboard dismissal failures, captured print/PDF boundaries, and enabled series/glossary/debate/prediction/calendar/subscriber/account/moderation actions.
- Safety guards propagate environment-generator failure before SQL/build/services. Each launcher creates and attests its own disposable database, refuses occupied ports and unattested builds/servers, and cleans up only owned resources.

### Confirmed Next image cancellation/cache defect

A minimal Next 16.2.2 app containing only a local image reproduced hanging later requests when the first request for that cache key was cancelled. Instrumentation showed the internal static-file response inherited the disconnected client socket and never reached stream completion; shared response caching then stranded later requests for that key. Correct valid-image requests returned 200 without cancellation. The portable original-function reproduction retained three timeout cases; after the upstream fix, all five valid requests returned exactly 200. Earlier expanded probes retained 22 before/after cases locally.

Installation backports [merged Next PR #98168](https://github.com/vercel/next.js/pull/98168), merge commit `dcbfff7789b84f39388228e6dab11456c446e269`: preserve the mocked request socket, detach the mocked response from it. The patch is pinned to 16.2.2, validates both CommonJS and ESM source signatures before writing and is idempotent. Framework versions remain unchanged. The regression uses real static streaming against a disconnected requester; no request rejection is hidden. Portable evidence: `test-results/image-abort-before.json` and `test-results/image-abort-after.json`.

## WebKit investigation and limits

Actual link controls, back/forward and rapid client clicks passed on both engines in the previous full workflow phase. The separate strict rapid document-navigation test still fails on Playwright WebKit and remains enabled, with no filtered errors, catches, skips or expected failures. Historical HTTP and local HTTPS both reproduced it.

Framework-free same-origin pagehide fetches with explicit rejection handlers reproduce native WebKit errors; CSP on/off does not remove them. A minimal Next application reproduces cancelled RSC prefetch errors while instrumentation records no `window.error` or unhandled-promise events. Playwright's WebKit console bridge classifies JavaScript-source native console errors as page errors. This supports a browser/tool diagnostic-boundary hypothesis, **not proof of harmless deployed behaviour**. The associated historical NextAuth session-fetch failure still lacks a separately confirmed application root cause. Reproductions and strict tests are retained.

Safari 27.0.1 is installed and its remote automation setting was observed enabled after the owner's `safaridriver --enable`. A fresh owned driver still returns HTTP 500: session creation times out after 30 seconds while connecting to Safari. No successful real Safari automation is claimed. The observed personal Safari developer settings also disable cross-origin restrictions, so a default-security Safari comparison requires an isolated/default configuration. The owner's settings and browsing are not changed.

## External verification required

No separate staging storage/email/OAuth credentials, controlled provider inboxes or physical devices were supplied. Local stand-ins cannot establish real bucket access policies, cross-user storage isolation, signed URL expiry, transformations, CDN invalidation, provider email delivery, OAuth or physical mobile behaviour.

Required follow-up: provide a non-production project/buckets and two controlled accounts; verify upload/read/delete and cross-account denial, signed URL expiration and transformations; provide a captured/staging email provider and controlled recipients, follow reset/unsubscribe links and verify expiry/reuse; run scheduling with isolated jobs and verify public visibility. With default-security Safari/WebDriver or a controlled Mac, run the cancellation probes and actual UI navigation/auth/article flows; repeat representative upload/editor/lifecycle controls on physical iOS and Android devices. No billable infrastructure or production mutations are authorised or attempted.

## Inventory and evidence

[Coverage inventory](coverage-inventory.md) separates browser actions, API/database checks, unit tests, source inspection, unavailable features, uncovered actions and externally blocked verification. [Source census](control-inventory.json) enumerates routes, conditional control declarations, dynamic row families and native dialogs; declaration or label matches are not browser evidence.

All retained screenshots/traces/HTML reports are run-scoped in ignored artifact directories. Authentication state, credentials and captured email/reset tokens are not committed. Useful editor/preview/published screenshots and Chromium PDF evidence are attached to workflow results. Cloud artifacts will provide downloadable links in the final report.

See [reproduction and isolation commands](README.md). The PR remains draft while material failures or required verification remain unresolved.
