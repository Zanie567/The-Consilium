// Reviewed action families map to executed scenarios, never literal-label matches.
// Scenario counts are not a count of individual actions; preserve API-only methods.
import fs from 'node:fs'
import assert from 'node:assert/strict'

const [summaryPath, output = 'docs/testing/action-results.json'] = process.argv.slice(2)
if (!summaryPath) throw Error('Usage: node scripts/build-action-results.mjs <single-run-summary.json> [output.json]')
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const inventory = fs.readFileSync('docs/testing/coverage-inventory.md', 'utf8')
const rows = inventory.split('## Meaningful action families')[1].split('## External limits')[0].split('\n').filter(line => line.startsWith('| ')).slice(1)
// [family prefix, browser/API scenario selectors [file stem, title regex], unit file stems]
const rules = [
  ['Sidebar/public', [['wf-roles', '.'], ['wf-mobile', '.'], ['wf-navigation', '.'], ['wf-public-controls', 'header|drawer|phone reader'], ['public', 'navigat|sign|theme']], []],
  ['Desktop footer', [['wf-public-controls', 'every desktop header']], []],
  ['Article section', [['wf-public-controls', 'article section links']], ['article-section-links']],
  ['Cookie consent', [['wf-public-controls', 'cookie privacy|guest reading']], ['signup-prompt-navigation']],
  ['iOS and Android', [['wf-public-controls', 'iOS and Android']], []],
  ['Reading-position', [['wf-public-controls', 'reading-position|reading position']], ['reading-position-boundaries']],
  ['Public team profile', [['wf-public-controls', 'public team cards']], []],
  ['Public glossary', [['wf-public-controls', 'public glossary']], ['glossary-linkify']],
  ['Root-layout', [['wf-public-controls', 'root chrome|database outage']], ['trash-feedback']],
  ['New article', [['wf-formatting', '.'], ['wf-lifecycle', '.'], ['wf-controls', 'document settings'], ['editorial', 'editor|draft|article']], []],
  ['Submit, feedback', [['wf-lifecycle', '.'], ['wf-formatting', 'submits|review preview|published article']], []],
  ['Inline review', [['wf-portal', 'inline review']], []],
  ['Schedule, scheduler', [['wf-lifecycle', 'schedul|due'], ['wf-access', 'staging a schedule']], []],
  ['Publish/unpublish', [['wf-controls', 'correction|document settings'], ['wf-publication-safety', '.'], ['wf-articles', 'Publish and Unpublish'], ['wf-failures', 'failed publish']], []],
  ['Warm home', [['wf-cache', '.']], []],
  ['Trash/restore', [['wf-articles', 'Delete|Trash'], ['wf-access', 'delet|trash|restore'], ['wf-remaining', 'trash restore'], ['wf-public-controls', 'database outage']], ['trash-feedback']],
  ['Bold/italic', [['wf-formatting', '.'], ['wf-controls', 'delete table']], ['article-render-formatting']],
  ['Bullet/ordered', [['wf-formatting', '.'], ['wf-controls', 'delete table']], ['article-render-formatting']],
  ['Colour/highlight', [['wf-formatting', '.'], ['wf-controls', 'delete table']], ['article-render-formatting']],
  ['Table picker', [['wf-formatting', '.'], ['wf-controls', 'delete table']], ['article-render-formatting']],
  ['Figure upload', [['wf-upload', '.'], ['wf-formatting', '.'], ['wf-mobile', '.']], []],
  ['Footnote insert', [['wf-formatting', '.'], ['wf-controls', 'footnotes'], ['footnotes', '.']], []],
  ['Tutorial/settings', [['wf-controls', 'delete table|document settings'], ['wf-formatting', 'build the article'], ['wf-mobile', '.']], []],
  ['Font family', [], ['article-render-formatting']],
  ['Failed 400', [['wf-failures', 'failed save|never answers|validation error|slow save|expired session|revoked account'], ['wf-recovery', '.'], ['wf-access', 'banned|demoted|scope']], []],
  ['Repeated Save', [['wf-failures', 'pressed twice|in flight|first autosave'], ['wf-publication-safety', '.'], ['wf-articles', 'Delete']], []],
  ['Two tabs', [['wf-failures', 'stale tab|conflict|version deliberately'], ['wf-access', 'overwrite|save over'], ['wf-recovery', 'stale recovery']], []],
  ['Failed navigation', [['wf-failures', 'Back to articles'], ['wf-recovery', '.']], ['draft-recovery']],
  ['Missing/deleted', [['wf-recovery', 'deleted originals'], ['wf-remaining', 'recover']], ['draft-recovery']],
  ['Invalid/4', [['wf-upload', '.']], []],
  ['Public password-reset', [['wf-accounts', 'password reset|two reset forms|legacy editorial login/reset']], ['editorial-login-recovery']],
  ['User row role', [['wf-access', 'role changes|banned|deleting an account'], ['team-profile-lifecycle', '.'], ['wf-remaining', 'legacy administration']], []],
  ['Legacy admin profile', [['wf-admin-profile', 'legacy administrator profile']], ['management-data-protection']],
  ['Admin warning', [['wf-admin-profile', 'administrator warnings']], []],
  ['User directory', [['wf-access', 'role changes'], ['wf-admin-profile', 'administrator directory']], ['admin-directory-sort', 'portal-request-order']],
  ['Comment creation', [['wf-reader', 'comments on'], ['wf-remaining', 'reader replies|moderation load'], ['wf-admin-content', 'comment moderation']], ['moderation-request-order']],
  ['Newsletter signup', [['wf-accounts', 'newsletter'], ['wf-admin-content', 'subscribers']], ['newsletter-input']],
  ['Share public author', [['wf-accounts', 'public author|biography failure']], ['author-utils']],
  ['Reader profile', [['wf-reader', '.'], ['wf-accounts', 'avatar|biography'], ['wf-discovery', 'reader history']], ['profile-feedback']],
  ['Notification open', [['wf-remaining', 'notification']], ['notification-navigation', 'route-feedback']],
  ['Commissioning brief', [['wf-portal', 'dashboard commissioning'], ['wf-remaining', 'achievement'], ['wf-articles', 'Delete']], []],
  ['Article status', [['wf-articles', '.'], ['wf-remaining', 'article status'], ['editor-scope', '.']], []],
  ['Series create', [['wf-portal', 'series creation'], ['wf-admin-content', 'series']], []],
  ['Debate create', [['wf-admin-content', 'debates'], ['wf-remaining', 'debate editing']], ['management-data-protection']],
  ['Glossary create', [['wf-portal', 'glossary'], ['wf-admin-content', 'glossary']], []],
  ['Predictions create', [['wf-portal', 'prediction'], ['wf-admin-content', 'predictions']], ['predictions']],
  ['Calendar next', [['wf-portal', 'calendar month'], ['wf-remaining', 'calendar dragging']], ['editorial-calendar']],
  ['Analytics date', [['wf-portal', 'analytics'], ['wf-discovery', 'analytics'], ['editorial', 'analytics']], ['analytics-request-recovery']],
  ['Share popups', [['wf-remaining', 'public copy']], []],
  ['Team form', [['team-profile', '.'], ['team-profile-lifecycle', '.']], []],
  ['Contact every', [['wf-discovery', 'contact failure'], ['public', 'contact|privacy|terms|about']], []],
  ['First-admin', [], [['route-handlers', 'POST /api/editorial/setup']]],
]
assert.equal(rows.length, rules.length, 'Every reviewed inventory family needs an explicit execution mapping')
const executed = summary.phases.flatMap(phase => phase.tests.map(test => ({ ...test, phase: phase.phase })))
const families = rows.map((row, i) => {
  const [, name, expected, method] = row.split('|').map(value => value.trim())
  const [prefix, selectors, units] = rules[i]
  assert(name.startsWith(prefix), `Inventory/rules disagree at family ${i + 1}: ${name}`)
  const cases = executed.filter(test => selectors.some(([file, title]) => test.file === `${file}.spec.ts` && new RegExp(title, 'i').test(test.title)))
  if (selectors.length) assert(cases.length > 0, `UNCOVERED: no executed scenario for ${name}`)
  const unitCases = (summary.vitest.tests ?? []).filter(test => units.some(rule => {
    const [file, title = '.'] = typeof rule === 'string' ? [rule] : rule
    return (test.file === `${file}.test.ts` || test.file === `${file}.test.tsx`) && new RegExp(title, 'i').test(test.title)
  }))
  return { id: `A${String(i + 1).padStart(2, '0')}`, actionFamily: name, expected, reviewedMethod: method,
    outcome: cases.some(test => test.outcome === 'unexpected') ? 'FAIL' : cases.some(test => test.outcome === 'skipped') ? 'PARTIALLY_EXECUTED' : cases.length ? 'PASS (listed scenarios)' : 'NO_BROWSER_UI (see method)',
    counts: { passed: cases.filter(test => test.outcome === 'expected').length, failed: cases.filter(test => test.outcome === 'unexpected').length, skipped: cases.filter(test => test.outcome === 'skipped').length },
    cases: cases.map(test => ({ phase: test.phase, file: test.file, line: test.line, title: test.title, project: test.project, method: test.method, outcome: test.outcome,
      evidence: test.executions.flatMap(execution => execution.attachments) })),
    unitCases,
  }
})
fs.writeFileSync(output, JSON.stringify({ exactTestedCommit: summary.exactTestedCommit, runURL: summary.runURL,
  scope: 'One exact complete run, explicit reviewed action-family mappings. Counts describe scenarios, not distinct actions. API-only scenarios remain identified. Intentional unavailable and external verification limits remain in the reviewed method; a scenario PASS does not establish an external boundary.', families }, null, 2) + '\n')
console.log(`${families.length} action families mapped to one exact run`)
