# Browser evidence index

Large artifacts are retained locally and ignored by git. Relative links target this audit worktree. Each phase records exact failures; no failing execution is reclassified by a later pass. See the report for synchronization corrections and environment limits.

## full-audit: next-e2e-3321-15965

Commit: `64ae87b64a3e39b7e5ad51cd9d470865d94c0f02`.

### main

83 passed; 1 failed; 0 skipped. [Raw results](../../test-results/next-e2e-3321-15965/main/results.json) · [HTML report](../../playwright-report/next-e2e-3321-15965/main/index.html)

| Project / spec | Passed | Failed | Skipped |
|---|---:|---:|---:|
| setup / auth.setup.ts | 6 | 0 | 0 |
| public / footnotes.spec.ts | 7 | 0 | 0 |
| public-webkit / footnotes.spec.ts | 7 | 0 | 0 |
| public / network-crawl.spec.ts | 3 | 0 | 0 |
| public / public.spec.ts | 16 | 0 | 0 |
| public-webkit / public.spec.ts | 15 | 1 | 0 |
| editorial / editorial-layout.spec.ts | 5 | 0 | 0 |
| editorial / editorial.spec.ts | 17 | 0 | 0 |
| editor / editor-scope.spec.ts | 3 | 0 | 0 |
| lifecycle / publication-lifecycle.spec.ts | 4 | 0 | 0 |

**Failure: public-webkit — navigating across pages throws no InvalidStateError (view-transition guard)**

- [screenshot](../../test-results/next-e2e-3321-15965/main/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/test-failed-1.png)
- [error-context](../../test-results/next-e2e-3321-15965/main/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/error-context.md)
- [error-context](../../test-results/next-e2e-3321-15965/main/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/error-context.md)
- [trace](../../test-results/next-e2e-3321-15965/main/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/trace.zip)

### team-profile

41 passed; 0 failed; 0 skipped. [Raw results](../../test-results/next-e2e-3321-15965/team-profile/results.json) · [HTML report](../../playwright-report/next-e2e-3321-15965/team-profile/index.html)

| Project / spec | Passed | Failed | Skipped |
|---|---:|---:|---:|
| team-profile / team-profile-lifecycle.spec.ts | 5 | 0 | 0 |
| team-profile / team-profile.spec.ts | 36 | 0 | 0 |

### workflow

205 passed; 3 failed; 0 skipped. [Raw results](../../test-results/next-e2e-3321-15965/workflow/results.json) · [HTML report](../../playwright-report/next-e2e-3321-15965/workflow/index.html)

| Project / spec | Passed | Failed | Skipped |
|---|---:|---:|---:|
| setup / auth.setup.ts | 6 | 0 | 0 |
| wf-chromium / wf-articles.spec.ts | 5 | 0 | 0 |
| wf-webkit / wf-articles.spec.ts | 5 | 0 | 0 |
| wf-chromium / wf-cache.spec.ts | 1 | 0 | 0 |
| wf-webkit / wf-cache.spec.ts | 1 | 0 | 0 |
| wf-chromium / wf-controls.spec.ts | 3 | 0 | 0 |
| wf-webkit / wf-controls.spec.ts | 2 | 1 | 0 |
| wf-chromium / wf-failures.spec.ts | 16 | 0 | 0 |
| wf-webkit / wf-failures.spec.ts | 15 | 1 | 0 |
| wf-chromium / wf-formatting.spec.ts | 6 | 0 | 0 |
| wf-webkit / wf-formatting.spec.ts | 6 | 0 | 0 |
| wf-chromium / wf-layout.spec.ts | 5 | 0 | 0 |
| wf-webkit / wf-layout.spec.ts | 5 | 0 | 0 |
| wf-chromium / wf-lifecycle.spec.ts | 8 | 0 | 0 |
| wf-webkit / wf-lifecycle.spec.ts | 8 | 0 | 0 |
| wf-chromium / wf-reader.spec.ts | 6 | 0 | 0 |
| wf-webkit / wf-reader.spec.ts | 6 | 0 | 0 |
| wf-chromium / wf-roles.spec.ts | 31 | 1 | 0 |
| wf-webkit / wf-roles.spec.ts | 32 | 0 | 0 |
| wf-chromium / wf-upload.spec.ts | 14 | 0 | 0 |
| wf-webkit / wf-upload.spec.ts | 14 | 0 | 0 |
| wf-mobile-chromium / wf-mobile.spec.ts | 5 | 0 | 0 |
| wf-mobile-webkit / wf-mobile.spec.ts | 5 | 0 | 0 |

**Failure: wf-webkit — review correction, commendation, feature and pin persist and corrections appear publicly**

- [screenshot](../../test-results/next-e2e-3321-15965/workflow/wf-controls-review-correct-ec7fc-corrections-appear-publicly-wf-webkit/test-failed-1.png)
- [screenshot](../../test-results/next-e2e-3321-15965/workflow/wf-controls-review-correct-ec7fc-corrections-appear-publicly-wf-webkit/test-failed-2.png)
- [error-context](../../test-results/next-e2e-3321-15965/workflow/wf-controls-review-correct-ec7fc-corrections-appear-publicly-wf-webkit/error-context.md)
- [error-context](../../test-results/next-e2e-3321-15965/workflow/wf-controls-review-correct-ec7fc-corrections-appear-publicly-wf-webkit/error-context.md)
- [trace](../../test-results/next-e2e-3321-15965/workflow/wf-controls-review-correct-ec7fc-corrections-appear-publicly-wf-webkit/trace.zip)

**Failure: wf-webkit — Back to articles stays in the editor when saving fails, then saves and leaves on retry**

- [screenshot](../../test-results/next-e2e-3321-15965/workflow/wf-failures-Back-to-articl-013d1-n-saves-and-leaves-on-retry-wf-webkit/test-failed-1.png)
- [error-context](../../test-results/next-e2e-3321-15965/workflow/wf-failures-Back-to-articl-013d1-n-saves-and-leaves-on-retry-wf-webkit/error-context.md)
- [error-context](../../test-results/next-e2e-3321-15965/workflow/wf-failures-Back-to-articl-013d1-n-saves-and-leaves-on-retry-wf-webkit/error-context.md)
- [trace](../../test-results/next-e2e-3321-15965/workflow/wf-failures-Back-to-articl-013d1-n-saves-and-leaves-on-retry-wf-webkit/trace.zip)

**Failure: wf-chromium — every menu entry opens, with a heading and no console errors**

- [screenshot](../../test-results/next-e2e-3321-15965/workflow/wf-roles-admin-every-menu--b23f4-ading-and-no-console-errors-wf-chromium/test-failed-1.png)
- [error-context](../../test-results/next-e2e-3321-15965/workflow/wf-roles-admin-every-menu--b23f4-ading-and-no-console-errors-wf-chromium/error-context.md)
- [trace](../../test-results/next-e2e-3321-15965/workflow/wf-roles-admin-every-menu--b23f4-ading-and-no-console-errors-wf-chromium/trace.zip)

- Successful wf-chromium: [representative-article-preview](evidence/wf-chromium-representative-article-preview.png)
- Successful wf-chromium: [representative-article-published](evidence/wf-chromium-representative-article-published.png)
- Successful wf-webkit: [representative-article-preview](evidence/wf-webkit-representative-article-preview.png)
- Successful wf-webkit: [representative-article-published](evidence/wf-webkit-representative-article-published.png)

[Vitest raw results](../../test-results/next-e2e-3321-15965/vitest.json) — 935 tests: 910 ordinary passes, seven pre-existing expected failures counted as passed by Vitest, 18 existing skips; zero unexpected failures.

[Build log](../../test-results/next-e2e-3321-15965/build.log) · [Server log](../../test-results/next-e2e-3321-15965/server.log)

## final-regression: next-e2e-3321-31884

Commit: `680c11b716c30a0596dbceab706ab3249910c576`.

### final-regression

54 passed; 1 failed; 0 skipped. [Raw results](../../test-results/next-e2e-3321-31884/final-regression/results.json) · [HTML report](../../playwright-report/next-e2e-3321-31884/final-regression/index.html)

| Project / spec | Passed | Failed | Skipped |
|---|---:|---:|---:|
| setup / auth.setup.ts | 6 | 0 | 0 |
| public-webkit / public.spec.ts | 0 | 1 | 0 |
| wf-chromium / wf-cache.spec.ts | 1 | 0 | 0 |
| wf-webkit / wf-cache.spec.ts | 1 | 0 | 0 |
| wf-chromium / wf-controls.spec.ts | 1 | 0 | 0 |
| wf-webkit / wf-controls.spec.ts | 1 | 0 | 0 |
| wf-chromium / wf-failures.spec.ts | 1 | 0 | 0 |
| wf-webkit / wf-failures.spec.ts | 1 | 0 | 0 |
| wf-chromium / wf-roles.spec.ts | 21 | 0 | 0 |
| wf-webkit / wf-roles.spec.ts | 21 | 0 | 0 |

**Failure: public-webkit — navigating across pages throws no InvalidStateError (view-transition guard)**

- [screenshot](../../test-results/next-e2e-3321-31884/final-regression/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/test-failed-1.png)
- [error-context](../../test-results/next-e2e-3321-31884/final-regression/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/error-context.md)
- [error-context](../../test-results/next-e2e-3321-31884/final-regression/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/error-context.md)
- [trace](../../test-results/next-e2e-3321-31884/final-regression/public-navigating-across-p-776ee-rror-view-transition-guard--public-webkit/trace.zip)

[Build log](../../test-results/next-e2e-3321-31884/build.log) · [Server log](../../test-results/next-e2e-3321-31884/server.log)

## cache-red: next-e2e-3321-11839

Commit: `c379afa7e161b2e540f9b8fa3a857cdd6b8cbb45 with uncommitted regression test`.

### cache-red2

6 passed; 2 failed; 0 skipped. [Raw results](../../test-results/next-e2e-3321-11839/cache-red2/results.json) · [HTML report](../../playwright-report/next-e2e-3321-11839/cache-red2/index.html)

| Project / spec | Passed | Failed | Skipped |
|---|---:|---:|---:|
| setup / auth.setup.ts | 6 | 0 | 0 |
| wf-chromium / wf-cache.spec.ts | 0 | 1 | 0 |
| wf-webkit / wf-cache.spec.ts | 0 | 1 | 0 |

**Failure: wf-chromium — publication and unpublication immediately refresh already visited public listings**

- [screenshot](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-chromium/test-failed-1.png)
- [screenshot](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-chromium/test-failed-2.png)
- [error-context](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-chromium/error-context.md)
- [error-context](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-chromium/error-context.md)
- [trace](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-chromium/trace.zip)

**Failure: wf-webkit — publication and unpublication immediately refresh already visited public listings**

- [screenshot](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-webkit/test-failed-2.png)
- [screenshot](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-webkit/test-failed-1.png)
- [error-context](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-webkit/error-context.md)
- [error-context](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-webkit/error-context.md)
- [trace](../../test-results/next-e2e-3321-11839/cache-red2/wf-cache-publication-and-u-29223-ady-visited-public-listings-wf-webkit/trace.zip)

[Build log](../../test-results/next-e2e-3321-11839/build.log) · [Server log](../../test-results/next-e2e-3321-11839/server.log)

## Earlier failure evidence

Original pre-fix traces and screenshots are preserved under [initial evidence](./evidence/initial/). The cache-red run above is the confirmed before-fix category-list failure. Diagnostic HTTPS reproduction: [JSON](./evidence/local-https-probe.json), [source record](./evidence/local-https-probe.cjs.txt).

## Rendered role inventories

Initial rendered page controls for all five roles, separate from the static source census:

- [chromium / admin](../../test-results/inventory/chromium/admin.json)
- [chromium / editor](../../test-results/inventory/chromium/editor.json)
- [chromium / growth](../../test-results/inventory/chromium/growth.json)
- [chromium / reader](../../test-results/inventory/chromium/reader.json)
- [chromium / writer](../../test-results/inventory/chromium/writer.json)
- [webkit / admin](../../test-results/inventory/webkit/admin.json)
- [webkit / editor](../../test-results/inventory/webkit/editor.json)
- [webkit / growth](../../test-results/inventory/webkit/growth.json)
- [webkit / reader](../../test-results/inventory/webkit/reader.json)
- [webkit / writer](../../test-results/inventory/webkit/writer.json)

## Original confirmed defects

- [team-profile-writer-create-a91a5-urred-during-the-whole-flow-team-profile trace](evidence/initial/team-profile/team-profile-writer-create-a91a5-urred-during-the-whole-flow-team-profile/trace.zip) · [screenshot](evidence/initial/team-profile/team-profile-writer-create-a91a5-urred-during-the-whole-flow-team-profile/test-failed-1.png)
- [wf-roles-admin-every-menu--b23f4-ading-and-no-console-errors-wf-webkit trace](evidence/initial/workflow/wf-roles-admin-every-menu--b23f4-ading-and-no-console-errors-wf-webkit/trace.zip) · [screenshot](evidence/initial/workflow/wf-roles-admin-every-menu--b23f4-ading-and-no-console-errors-wf-webkit/test-failed-1.png)
- [wf-roles-editor-every-menu-c9a15-ading-and-no-console-errors-wf-webkit trace](evidence/initial/workflow/wf-roles-editor-every-menu-c9a15-ading-and-no-console-errors-wf-webkit/trace.zip) · [screenshot](evidence/initial/workflow/wf-roles-editor-every-menu-c9a15-ading-and-no-console-errors-wf-webkit/test-failed-1.png)
