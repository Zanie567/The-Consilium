import { test, expect, type Page } from '@playwright/test'
import { closeDb, createAccount, db, hydrated, removeMyAccounts, signInAs } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Testing Mode scenarios, end to end. A real administrator puts a real test persona into a known
 * situation, enters the persona's session, and checks the prompts, notifications and pages that
 * the situation should (and should not) produce. Everything is undone afterwards.
 */
test.describe.configure({ mode: 'serial' })
test.afterAll(async () => { await removeMyAccounts(); await closeDb() })

const scenario = (page: Page, id: string) => page.getByTestId(`scenario-${id}`)
const PROMPT = 'Complete your team profile'

async function apply(page: Page, id: string) {
  await scenario(page, id).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'applied to' })).toBeVisible()
  await expect(scenario(page, id)).toContainText('Applied')
}
async function pickPersona(page: Page, label: string) {
  await page.getByLabel('Persona', { exact: true }).selectOption({ label })
}
async function openTesting(page: Page) {
  await page.goto('/admin/testing')
  await expect(page.getByRole('heading', { name: 'Testing', exact: true, level: 1 })).toBeVisible()
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
}
async function enter(page: Page, name: string, label: string) {
  await page.getByRole('button', { name, exact: true }).last().click()
  await expect(page.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText(label)
}

test('scenarios put a persona into a known state, show the right prompts, and reset restores everything', async ({ browser }) => {
  test.setTimeout(240_000)
  const admin = await createAccount('ADMIN', 'scenarios')
  const context = await signInAs(browser, admin)
  const page = await context.newPage()
  const errors = collectConsoleErrors(page)
  const writer = await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'writer' } })
  const editor = await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'editor' } })
  const cardBefore = await db().teamMember.findUnique({ where: { userId: writer.id } })
  // Earlier specs in a full run leave unread notifications on the shared persona. The bell counts all
  // of them, so set them aside for this test (and put them back at the end) to assert exactly 3.
  // Plant one stray unread notification so the "exactly 3" assertions are proven under pollution, not just on a clean database.
  const stray = await db().notification.create({ data: { userId: writer.id, type: 'review', title: 'Stray notification from another test', message: 'Not a scenario notification.' } })
  const otherUnread = (await db().notification.findMany({ where: { userId: writer.id, read: false, type: { not: 'testing-scenario' } }, select: { id: true } })).map((n) => n.id)
  await db().notification.updateMany({ where: { id: { in: otherUnread } }, data: { read: true } })
  // Same for achievements: the dashboard banner shows the first UNSEEN first-publish of any origin, so an earlier
  // spec's real one would appear as soon as the scenario's is dismissed. Plant one, set all others aside, restore after.
  const strayAchievement = await db().writerAchievement.create({ data: { userId: writer.id, type: 'first_publish', referenceId: 'stray-from-another-test', seenAt: null } })
  const otherUnseen = (await db().writerAchievement.findMany({ where: { userId: writer.id, seenAt: null, referenceId: { not: 'testing-scenario' } }, select: { id: true } })).map((a) => a.id)
  await db().writerAchievement.updateMany({ where: { id: { in: otherUnseen } }, data: { seenAt: new Date() } })
  const stripped = (c: typeof cardBefore) => (c ? { ...c, updatedAt: undefined } : null)

  await openTesting(page)
  await expect(page.getByTestId('testing-environment')).toContainText('Isolated test workspace')
  await expect(page.getByTestId('testing-checklist')).toHaveCount(0) // nothing is missing here

  // Writer cards describe what the role should see, from the same navigation the sidebar uses.
  await expect(page.getByText(/Should see in the menu: .*My Articles/).first()).toBeVisible()

  // 1. A newly registered member: the profile prompt, no unread count.
  await apply(page, 'newly-registered')
  expect(await db().teamMember.count({ where: { userId: writer.id } })).toBe(0)
  await enter(page, 'Test as Writer', 'Writer')
  await page.goto('/editorial')
  await expect(page.getByText(PROMPT)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByTestId('admin-overview')).toHaveCount(0) // administrator content never reaches a persona

  // 2. A completed profile: the prompt is gone.
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await apply(page, 'completed-profile')
  await page.goto('/editorial')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(PROMPT)).toHaveCount(0)

  // 3. Unread notifications: the bell counts three. Dismissed ones do not count.
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await apply(page, 'unread-notifications')
  await page.goto('/editorial')
  await expect(page.getByRole('button', { name: '3 unread notifications', exact: true })).toBeVisible()
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await apply(page, 'dismissed-notifications')
  await page.goto('/editorial')
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /unread notifications/ })).toHaveCount(0)

  // 4. A draft and a submitted article appear where the role finds them.
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await apply(page, 'writer-draft')
  await apply(page, 'writer-submitted')
  await page.goto('/editorial/articles')
  await expect(page.getByText('[Scenario] Draft in progress').first()).toBeVisible()
  await expect(page.getByText('[Scenario] Submitted for review').first()).toBeVisible()

  // 5. The first-publish banner is shown once and stays gone after dismissal.
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await apply(page, 'first-publish')
  await page.goto('/editorial')
  await expect(page.getByText('Your first article has been published.')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.getByText('Your first article has been published.')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Your first article has been published.')).toHaveCount(0) // stays dismissed
  expect(await db().writerAchievement.count({ where: { userId: writer.id, referenceId: 'testing-scenario', seenAt: null } })).toBe(0)

  // 6. Restricted functionality really is refused, page by page and API by API, as the persona.
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await page.getByRole('button', { name: 'Check access as Writer' }).click()
  await expect(page.getByTestId('access-results')).toContainText('All ')
  await expect(page.getByTestId('access-results')).toContainText('checks behaved as expected')
  await expect(page.getByTestId('access-results').getByText('FAIL')).toHaveCount(0)
  expect(await page.getByTestId('access-results').locator('tbody tr').count()).toBeGreaterThan(8)

  // 7. The editor queue, for a different persona, written by the second writer.
  await enter(page, 'Test as Editor', 'Editor')
  await page.goto('/admin/testing') // switching lands on the dashboard; the Testing page stays reachable in a session
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await pickPersona(page, 'Editor')
  await apply(page, 'editor-queue')
  await page.goto('/editorial/review')
  await expect(page.getByText('[Scenario] Awaiting review 1').first()).toBeVisible()
  await expect(page.getByText('[Scenario] Awaiting review 2').first()).toBeVisible()
  expect(await db().article.count({ where: { slug: { startsWith: 'testing-scenario-queue-' } } })).toBe(2)

  // 8. Reset: every persona back exactly as it was, nothing of the scenarios left.
  await page.goto('/admin/testing')
  await hydrated(page.getByLabel('Persona', { exact: true }), 'onChange')
  await page.getByRole('button', { name: 'Reset all personas' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Every test persona reset' })).toBeVisible()
  expect(stripped(await db().teamMember.findUnique({ where: { userId: writer.id } }))).toEqual(stripped(cardBefore))
  expect(await db().notification.count({ where: { type: 'testing-scenario' } })).toBe(0)
  expect(await db().article.count({ where: { slug: { startsWith: 'testing-scenario' } } })).toBe(0)
  expect(await db().writerAchievement.count({ where: { referenceId: 'testing-scenario' } })).toBe(0)
  expect(await db().siteSetting.count({ where: { key: { startsWith: 'testing-scenario-snapshot:' } } })).toBe(0)
  expect(await db().user.count({ where: { id: { in: [writer.id, editor.id] }, role: { in: ['WRITER', 'EDITOR'] } } })).toBe(2) // roles untouched

  await page.getByRole('button', { name: 'Exit testing mode' }).last().click()
  await expect(page.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Administrator')
  expect(errors.filter((e) => !/status of (40[0-9]|409) /.test(e))).toEqual([])
  await db().notification.updateMany({ where: { id: { in: otherUnread.filter((id) => id !== stray.id) } }, data: { read: false } })
  await db().notification.delete({ where: { id: stray.id } })
  await db().writerAchievement.updateMany({ where: { id: { in: otherUnseen.filter((id) => id !== strayAchievement.id) } }, data: { seenAt: null } })
  await db().writerAchievement.delete({ where: { id: strayAchievement.id } })
  await context.close()
})

test('only an administrator on the real origin can use scenarios; others are refused and nothing changes', async ({ browser }) => {
  test.setTimeout(90_000)
  const writer = await createAccount('WRITER', 'scenario-intruder')
  const ctx = await signInAs(browser, writer)
  const base = process.env.E2E_BASE_URL!
  const attempt = await ctx.request.post('/api/testing-scenarios', { headers: { origin: base }, data: { action: 'apply', persona: 'writer', scenario: 'unread-notifications' } })
  expect(attempt.status()).toBe(403)
  const reset = await ctx.request.post('/api/testing-scenarios', { headers: { origin: base }, data: { action: 'reset' } })
  expect(reset.status()).toBe(403)
  const read = await ctx.request.get('/api/testing-scenarios?persona=writer')
  expect(await read.json()).toEqual({ state: null }) // a non-administrator learns nothing
  expect(await db().notification.count({ where: { type: 'testing-scenario' } })).toBe(0)
  await ctx.close()

  const anonymous = await browser.newContext()
  // The proxy turns an unauthenticated caller away (401) before the handler would (403).
  expect([401, 403]).toContain((await anonymous.request.post('/api/testing-scenarios', { headers: { origin: base }, data: { action: 'reset' } })).status())
  await anonymous.close()

  // The page itself is administrator-only too.
  const ordinary = await signInAs(browser, await createAccount('EDITOR', 'scenario-editor'))
  const p = await ordinary.newPage()
  await p.goto('/admin/testing')
  await expect(p).toHaveURL(/\/editorial$/)
  await ordinary.close()
})
