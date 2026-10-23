import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { closeDb, createAccount, db, hydrated, removeMyAccounts, signInAs, signedIn, withCookieConsentAnswered, type TestAccount } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Every page this spec opens asks for reduced motion, which the site honours (globals.css: no smooth scrolling, no portal
 * page-enter animation). Buttons such as "New profile" sit low on a long page; while the page was still animating and
 * smooth-scrolling, CI WebKit pressed the button and released elsewhere, so it was focused but never clicked (issue #135,
 * CI runs 38642801819 and 38729322669: click points y=43, then y=20, then y=655 for the same button). wf-public-controls
 * does the same.
 */
async function steadyPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return page
}

/**
 * Team Members, end to end: an administrator assigns an existing Meet the Team profile to a new
 * account, edits the public position independently of the access role, and the public Our Team
 * page reflects exactly what was saved. Also: only administrators get in, and a stale form is
 * refused. Real browser, real server, real isolated database.
 */
test.describe.configure({ mode: 'serial' })

const run = Date.now().toString(36)
const createdCardIds: string[] = []

test.afterAll(async () => {
  await db().auditLog.deleteMany({ where: { targetId: { in: createdCardIds } } })
  await db().teamMember.deleteMany({ where: { OR: [{ id: { in: createdCardIds } }, { name: { startsWith: `WF Card ${run}` } }] } })
  await removeMyAccounts()
  await closeDb()
})

async function legacyCard(label: string, extra: Record<string, unknown> = {}) {
  const card = await db().teamMember.create({
    data: {
      name: `WF Card ${run} ${label}`,
      role: 'Staff Writer',
      bio: `Biography of ${label}.`,
      order: 4000,
      isActive: true,
      publicTier: 'writer',
      ...extra,
    },
  })
  createdCardIds.push(card.id)
  return card
}

/** What an anonymous visitor sees on the Our Team page. */
async function publicTeam(browser: Browser) {
  const context = await browser.newContext()
  try {
    const page = await steadyPage(context)
    await page.goto('/team')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // The roster streams in after the heading. A seeded member is the signal that it has rendered.
    await expect(page.locator('main')).toContainText('Alexander Escala', { ignoreCase: true })
    // textContent, not innerText: the page styles names in capitals, which innerText would return.
    return ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ')
  } finally {
    await context.close()
  }
}

/**
 * The readiness every load of the members page needs before it is touched, whether by `goto` or by `reload`:
 * the heading is rendered, the scroll is instant, and React has attached the Search field's handler.
 * The site sets `scroll-behavior: smooth` on <html>. Playwright scrolls the Manage button into view and clicks it
 * while that animation is still running; on a loaded WebKit the button moves between mousedown and mouseup, so the
 * button is focused but no click is delivered and the panel never opens. The injected style belongs to the
 * document, so a reload discards it and it has to be applied again.
 */
async function membersPageReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'Team Members', level: 1 })).toBeVisible()
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important }' })
  await hydrated(page.getByLabel('Search'), 'onChange')
}

async function openMember(page: Page, account: TestAccount) {
  await page.goto('/editorial/members')
  return findMember(page, account)
}

async function reloadMembers(page: Page, account: TestAccount) {
  await page.reload()
  return findMember(page, account)
}

async function findMember(page: Page, account: TestAccount) {
  await membersPageReady(page)
  await page.getByLabel('Search').fill(account.email)
  const row = page.getByTestId(`member-${account.email}`)
  await expect(row).toBeVisible()
  return row
}

/**
 * toBeVisible() ignores opacity. Under reduced motion the portal's entrance wrappers once kept the server's
 * opacity:0 after hydration, so the whole members page was invisible yet fully clickable.
 */
async function effectiveOpacity(locator: Locator) {
  return locator.evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return opacity
  })
}

/** Opens the member's management panel and waits until it is actually there (it shows a Close control). */
async function manage(row: Locator) {
  await row.getByRole('button', { name: 'Manage' }).click()
  await expect(row.getByRole('button', { name: 'Close' })).toBeVisible()
}

test('assigning an existing profile to a new account: nothing is lost, the owner can then edit it, the public page follows', async ({ browser }) => {
  test.setTimeout(180_000)
  const account = await createAccount('WRITER', 'newhire')
  const card = await legacyCard('Assign', { email: null })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  const errors = collectConsoleErrors(page)

  // The new account is obvious: flagged, and in the "Needs profile" view.
  const row = await openMember(page, account)
  await expect(row).toContainText('New')
  await expect(row).toContainText('No profile yet')
  await page.getByLabel('Search').fill('')
  await page.getByRole('group', { name: 'Filter members' }).getByRole('button', { name: /Needs profile/ }).click()
  await page.getByLabel('Search').fill(account.email)
  await expect(page.getByTestId(`member-${account.email}`)).toBeVisible()

  // Manage opens straight onto the Public profile section, and lists only unowned profiles.
  await page.getByTestId(`member-${account.email}`).getByRole('button', { name: 'Manage' }).click()
  await expect(page.getByRole('tab', { name: 'Public profile', selected: true })).toBeVisible()
  await page.getByLabel('Existing profile without an account').selectOption({ label: `${card.name}, Staff Writer` })
  await page.getByRole('button', { name: 'Link profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Linked' })).toBeVisible()

  // Persisted exactly: only the owner changed.
  const linked = await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })
  expect(linked).toMatchObject({ userId: account.id, name: card.name, role: 'Staff Writer', bio: card.bio, order: 4000, isActive: true, publicTier: 'writer' })
  expect(await db().auditLog.count({ where: { targetId: card.id, action: 'TEAM_CARD_LINKED' } })).toBe(1)
  await expect(page.getByTestId(`member-${account.email}`)).toContainText('Published')
  await expect(page.getByTestId(`member-${account.email}`)).toContainText('Linked to this account')

  // The public page shows the profile, once.
  const text = await publicTeam(browser)
  expect(text.split(card.name).length - 1).toBe(1)
  expect(text).toContain('Staff Writer')

  // The new owner now edits their own profile from their own portal, and can change nothing else.
  const own = await withCookieConsentAnswered(await signInAs(browser, account))
  const ownPage = await steadyPage(own)
  await ownPage.goto('/editorial/team-profile')
  const description = ownPage.getByLabel('Description')
  // Server-rendered controls can be filled before React hydrates them, particularly in WebKit.
  // That loses the edit; the form then reports a successful no-op save.
  await hydrated(description, 'onChange')
  await description.fill('Now in my own words.')
  await expect(ownPage.getByText('Unsaved changes')).toBeVisible()
  const saved = ownPage.waitForResponse(
    response => response.url().endsWith('/api/team-profile') && response.request().method() === 'PUT',
  )
  await ownPage.getByRole('button', { name: 'Save changes' }).click()
  const saveResponse = await saved
  expect(saveResponse.status()).toBe(200)
  expect((await saveResponse.json()).bio).toBe('Now in my own words.')
  await expect(ownPage.getByRole('status').filter({ hasText: 'has been saved' })).toBeVisible()
  const edited = await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })
  expect(edited).toMatchObject({ bio: 'Now in my own words.', role: 'Staff Writer', order: 4000, userId: account.id })
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).bio).toBe('Now in my own words.')
  expect((await ownPage.request.get('/api/admin/team-members')).status()).toBe(403)
  await own.close()

  expect((await publicTeam(browser))).toContain('Now in my own words.')

  // Admin changes the PUBLIC position; the access role is untouched.
  await manage(await reloadMembers(page, account))
  await page.getByRole('tab', { name: 'Public profile' }).click()
  const position = page.getByLabel('Public position', { exact: true })
  await expect(position).toHaveValue('Staff Writer')
  await position.fill('Senior Contributor')
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('WRITER')
  const reloaded = await reloadMembers(page, account)
  await expect(reloaded).toContainText('Senior Contributor') // persisted after reload
  expect(await publicTeam(browser)).toContain('Senior Contributor')

  // ...and changing the ACCESS role leaves the public title alone.
  await manage(reloaded)
  await page.getByRole('tab', { name: 'Role & permissions' }).click()
  await page.getByLabel(`Access role for ${account.email}`).selectOption('EDITOR')
  await page.getByRole('button', { name: 'Change role' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Role changed to editor' })).toBeVisible()
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('EDITOR')
  expect((await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })).role).toBe('Senior Contributor')
  expect(await publicTeam(browser)).toContain('Senior Contributor')

  expect(errors.filter((e) => !/status of 40[0-9]/.test(e))).toEqual([])
  await admin.close()
})

test('creating a new profile for an account links it, starts hidden, and goes public only when published', async ({ browser }) => {
  test.setTimeout(150_000)
  const account = await createAccount('EDITOR', 'create')
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  const row = await openMember(page, account)
  await row.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Create a new profile' }).click()

  const name = `WF Card ${run} Created`
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Public position', { exact: true }).fill('Deputy Editor')
  await page.getByLabel('Biography').fill('Created by an administrator.')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile created and linked' })).toBeVisible()

  const created = await db().teamMember.findUniqueOrThrow({ where: { userId: account.id } })
  createdCardIds.push(created.id)
  expect(created).toMatchObject({ name, role: 'Deputy Editor', isActive: false })
  expect((await publicTeam(browser))).not.toContain(name) // hidden until deliberately shown

  // The member's panel stays open after creating, now showing the new profile for editing.
  await expect(page.getByTestId(`member-${account.email}`).getByRole('button', { name: 'Close' })).toBeVisible()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  const visibility = page.getByTestId('profile-visibility')
  await expect(visibility.getByTestId('publication-status')).toHaveText('Hidden')
  await visibility.getByRole('button', { name: 'Publish profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'now appears on the Our Team page' })).toBeVisible()
  await expect(visibility.getByTestId('publication-status')).toHaveText('Published')
  expect(await publicTeam(browser)).toContain(name)

  // Hide again, then delete: the public page follows both, the account is untouched.
  await visibility.getByRole('button', { name: 'Hide from public page' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'is no longer on the Our Team page' })).toBeVisible()
  await expect(visibility.getByTestId('publication-status')).toHaveText('Hidden')
  expect(await publicTeam(browser)).not.toContain(name)
  await page.getByRole('button', { name: 'Delete profile' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile deleted' })).toBeVisible()
  expect(await db().teamMember.count({ where: { userId: account.id } })).toBe(0)
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('EDITOR')
  await admin.close()
})

test('visibility is explained and enforced: incomplete and suspended profiles cannot be published, members cannot publish themselves', async ({ browser }) => {
  test.setTimeout(180_000)
  // Already public before this test: it must stay exactly as it is throughout.
  const published = await legacyCard('Untouched', { bio: 'Bio to be added' })
  const before = await db().teamMember.findUniqueOrThrow({ where: { id: published.id } })

  // An incomplete profile: hidden, no position and no biography.
  const writer = await createAccount('WRITER', 'incomplete')
  const incomplete = await db().teamMember.create({
    data: { name: `WF Card ${run} Incomplete`, role: '', bio: null, order: 1000, isActive: false, userId: writer.id },
  })
  createdCardIds.push(incomplete.id)
  // A complete profile whose account is suspended.
  const suspended = await createAccount('GROWTH', 'suspended')
  const held = await db().teamMember.create({
    data: { name: `WF Card ${run} Suspended`, role: 'Growth & Communications', publicTier: 'growth', bio: 'A real biography.', order: 1000, isActive: false, userId: suspended.id },
  })
  createdCardIds.push(held.id)
  await db().user.update({ where: { id: suspended.id }, data: { isBanned: true } })

  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)

  // The list says why, without opening anything.
  const row = await openMember(page, writer)
  await expect(row).toContainText('Incomplete')
  await expect(row).toContainText('Needs: position, bio')
  await manage(row)
  await page.getByRole('tab', { name: 'Public profile' }).click()
  const visibility = page.getByTestId('profile-visibility')
  await expect(visibility.getByTestId('publication-status')).toHaveText('Incomplete')
  await expect(visibility).toContainText('It has no public position')
  await expect(visibility).toContainText('It has no biography')
  await expect(visibility.getByRole('button', { name: 'Publish profile' })).toBeDisabled()
  // The status and its controls fit a phone screen.
  await page.setViewportSize({ width: 375, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await visibility.scrollIntoViewIfNeeded()
  expect(await effectiveOpacity(visibility)).toBe(1)
  await page.setViewportSize({ width: 1280, height: 900 })
  // Completing it makes it publishable, but saving alone does not publish it.
  await page.getByLabel('Public position', { exact: true }).fill('Writer')
  await page.getByLabel('Biography').fill('Now complete.')
  await expect(visibility.getByRole('button', { name: 'Publish profile' })).toBeDisabled() // unsaved changes
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  await expect(visibility.getByTestId('publication-status')).toHaveText('Hidden')
  expect((await db().teamMember.findUniqueOrThrow({ where: { id: incomplete.id } })).isActive).toBe(false)
  expect(await publicTeam(browser)).not.toContain(incomplete.name)

  // The suspended account: explained, the button is off, and the API refuses a forced request.
  const heldRow = await openMember(page, suspended)
  await expect(heldRow).toContainText('Not eligible')
  await manage(heldRow)
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await expect(visibility).toContainText('The linked account is suspended')
  await expect(visibility.getByRole('button', { name: 'Publish profile' })).toBeDisabled()
  const forced = await page.request.post(`/api/admin/team-cards/${held.id}/visibility`, { data: { visible: true } })
  expect(forced.status()).toBe(409)
  expect((await db().teamMember.findUniqueOrThrow({ where: { id: held.id } })).isActive).toBe(false)
  expect(await publicTeam(browser)).not.toContain(held.name)

  // Ordinary members cannot publish themselves or gain anything through the publish route.
  for (const role of ['WRITER', 'EDITOR', 'GROWTH'] as const) {
    const member = role === 'WRITER' ? writer : await createAccount(role, `self-${role.toLowerCase()}`)
    const own = await withCookieConsentAnswered(await signInAs(browser, member))
    const res = await own.request.post(`/api/admin/team-cards/${incomplete.id}/visibility`, { data: { visible: true } })
    expect([401, 403], role).toContain(res.status())
    expect((await own.request.put('/api/team-profile', { multipart: { bio: 'Mine', visible: 'true' } })).status()).toBe(400)
    await own.close()
    expect((await db().user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe(role)
  }
  expect((await db().teamMember.findUniqueOrThrow({ where: { id: incomplete.id } })).isActive).toBe(false)

  // The administrator publishes it deliberately; it lands in Writers; the pre-existing card is untouched.
  await openMember(page, writer).then(manage)
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await visibility.getByRole('button', { name: 'Publish profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'now appears on the Our Team page under Writers' })).toBeVisible()
  await visibility.scrollIntoViewIfNeeded()
  expect(await effectiveOpacity(visibility)).toBe(1)
  const publicPage = await steadyPage(await browser.newContext())
  await publicPage.goto('/team')
  await expect(publicPage.locator(`section[aria-labelledby="team-writers"] [data-team-member-id="${incomplete.id}"]`)).toBeVisible()
  await expect(publicPage.locator(`[data-team-member-id="${published.id}"]`)).toBeVisible()
  await publicPage.context().close()
  expect(await db().teamMember.findUniqueOrThrow({ where: { id: published.id } })).toEqual(before)
  expect((await db().user.findUniqueOrThrow({ where: { id: writer.id } })).role).toBe('WRITER')
  await admin.close()
})

test('a second profile with the same name needs an explicit confirmation', async ({ browser }) => {
  test.setTimeout(90_000)
  const existing = await legacyCard('Twin')
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  await page.goto('/editorial/members')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto') // see steadyPage
  await hydrated(page.getByRole('button', { name: 'New profile' }), 'onClick')
  await page.getByRole('button', { name: 'New profile' }).click()
  await page.getByLabel('Name', { exact: true }).fill(existing.name.toUpperCase())
  await page.getByLabel('Public position', { exact: true }).fill('Writer')
  await page.getByLabel('Biography').fill('A different person with the same name.')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await expect(page.getByText(/already exists/)).toBeVisible()
  expect(await db().teamMember.count({ where: { name: { equals: existing.name, mode: 'insensitive' } } })).toBe(1)
  await page.getByRole('button', { name: 'This is a different person. Create anyway' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile created' })).toBeVisible()
  const both = await db().teamMember.findMany({ where: { name: { equals: existing.name, mode: 'insensitive' } } })
  expect(both).toHaveLength(2)
  createdCardIds.push(...both.map((c) => c.id))
  await admin.close()
})

test('the Editor-in-Chief profile keeps its title and place when the account role is changed', async ({ browser }) => {
  test.setTimeout(120_000)
  const chief = await createAccount('ADMIN', 'chief')
  const card = await legacyCard('Chief', { userId: chief.id, role: 'Editor-in-Chief', publicTier: null, order: -500, bio: 'Leads the publication.' })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  const row = await openMember(page, chief)
  await expect(row).toContainText('Editor-in-Chief')
  await row.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Role & permissions' }).click()
  for (const role of ['EDITOR', 'ADMIN']) {
    await page.getByLabel(`Access role for ${chief.email}`).selectOption(role)
    await page.getByRole('button', { name: 'Change role' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Role changed to ${role.toLowerCase()}` })).toBeVisible()
    expect(await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ role: 'Editor-in-Chief', userId: chief.id, name: card.name })
    expect(await publicTeam(browser)).toContain('Editor-in-Chief')
  }
  await admin.close()
})

test('only administrators can open Team Members or call its APIs; a stale profile form is refused', async ({ browser }) => {
  test.setTimeout(150_000)
  for (const who of ['editor', 'writer', 'growth'] as const) {
    const context = await withCookieConsentAnswered(await signedIn(browser, who))
    const page = await steadyPage(context)
    await page.goto('/editorial/members')
    await expect(page).toHaveURL(/\/editorial$/)
    await expect(page.getByRole('heading', { name: 'Team Members' })).toHaveCount(0)
    for (const request of [
      () => context.request.get('/api/admin/team-members'),
      () => context.request.post('/api/team', { data: { name: `WF Card ${run} Intruder` } }),
      () => context.request.post('/api/admin/team-cards/reorder', { data: { ids: ['x'] } }),
    ]) {
      expect([401, 403], who).toContain((await request()).status())
    }
    await context.close()
  }
  expect(await db().teamMember.count({ where: { name: `WF Card ${run} Intruder` } })).toBe(0)

  // Stale form: two tabs open on the same profile; the second save is refused, not merged.
  const account = await createAccount('WRITER', 'stale')
  const card = await legacyCard('Stale', { userId: account.id })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const first = await steadyPage(admin)
  const second = await steadyPage(admin)
  for (const page of [first, second]) {
    const row = await openMember(page, account)
    await row.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: 'Public profile' }).click()
  }
  await first.getByLabel('Public position', { exact: true }).fill('First Tab Title')
  await first.getByRole('button', { name: 'Save public details' }).click()
  await expect(first.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  await second.getByLabel('Public position', { exact: true }).fill('Second Tab Title')
  await second.getByRole('button', { name: 'Save public details' }).click()
  await expect(second.getByText(/changed since you opened it/)).toBeVisible()
  expect((await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })).role).toBe('First Tab Title')
  // The refused tab keeps what was typed, so nothing is lost while the admin decides.
  await expect(second.getByLabel('Public position', { exact: true })).toHaveValue('Second Tab Title')
  await admin.close()
})

test('a generated placeholder is replaced by the real profile after an explicit confirmation; a genuine profile offers no replacement', async ({ browser }) => {
  test.setTimeout(180_000)
  const account = await createAccount('WRITER', 'placeholder')
  // Exactly what a claim leaves behind: hidden, the account's own name, the role's default title, nothing written.
  const placeholder = await db().teamMember.create({
    data: { userId: account.id, name: account.name, role: 'Writer', publicTier: 'writer', order: 1000, isActive: false },
  })
  createdCardIds.push(placeholder.id)
  const real = await legacyCard('Real Profile', { email: null })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  const errors = collectConsoleErrors(page)

  const row = await openMember(page, account)
  await row.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  const section = page.getByTestId('replace-placeholder')
  await expect(section).toBeVisible()
  await expect(section.getByRole('heading', { name: 'Replace with an existing profile' })).toBeVisible()

  // The confirmation names the account, the placeholder and the profile to link, and nothing happens until confirmed.
  await section.getByLabel('Existing profile to link instead of the placeholder').selectOption({ label: `${real.name}, Staff Writer` })
  await section.getByRole('button', { name: 'Replace…' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(account.email)
  await expect(dialog).toContainText(placeholder.name)
  await expect(dialog).toContainText(real.name)
  expect(await db().teamMember.findUnique({ where: { id: placeholder.id } })).not.toBeNull() // not yet
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await db().teamMember.findUnique({ where: { id: real.id } })).toMatchObject({ userId: null })

  await section.getByRole('button', { name: 'Replace…' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Replace placeholder', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'removed the placeholder' })).toBeVisible()

  // Persisted: the real profile, untouched but for its owner; no placeholder; one card; role unchanged.
  expect(await db().teamMember.findUnique({ where: { id: placeholder.id } })).toBeNull()
  expect(await db().teamMember.findUniqueOrThrow({ where: { id: real.id } })).toMatchObject({ userId: account.id, name: real.name, bio: real.bio, role: 'Staff Writer', order: 4000, isActive: true })
  expect(await db().teamMember.count({ where: { userId: account.id } })).toBe(1)
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('WRITER')
  expect(await db().auditLog.count({ where: { targetId: real.id, action: 'TEAM_CARD_PLACEHOLDER_REPLACED' } })).toBe(1)

  // After a reload the screen shows the real profile, as a genuine one with no replace option.
  await page.reload()
  await openMember(page, account)
  await expect(page.getByTestId(`member-${account.email}`)).toContainText('Published')
  await page.getByTestId(`member-${account.email}`).getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await expect(page.getByTestId('replace-placeholder')).toHaveCount(0)
  await expect(page.getByTestId('genuine-profile-note')).toBeVisible()

  // Public Meet the Team shows the real profile once.
  const text = await publicTeam(browser)
  expect(text.split(real.name).length - 1).toBe(1)
  expect(text).not.toContain(placeholder.name)

  // A second, genuinely written profile can never be replaced in one step.
  const writer = await createAccount('WRITER', 'writtenprofile')
  const written = await db().teamMember.create({ data: { userId: writer.id, name: `WF Card ${run} Written`, role: 'Writer', publicTier: 'writer', order: 1000, isActive: false, bio: 'I wrote this myself.' } })
  createdCardIds.push(written.id)
  await openMember(page, writer)
  await page.getByTestId(`member-${writer.email}`).getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await expect(page.getByTestId('replace-placeholder')).toHaveCount(0)
  await expect(page.getByTestId('genuine-profile-note')).toContainText('biography')

  expect(errors.filter((e) => !/status of 40[0-9]/.test(e))).toEqual([])
  await admin.close()
})

test('the "saved" message always describes the latest attempt: it clears on a new edit and is never shown after a failed save', async ({ browser }) => {
  test.setTimeout(150_000)
  const account = await createAccount('WRITER', 'savemsg')
  const card = await legacyCard('SaveMsg', { email: null, userId: account.id })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  const row = await openMember(page, account)
  await row.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  const status = page.getByRole('status').filter({ hasText: 'Public details saved' })
  const bio = page.getByLabel('Biography', { exact: true })

  await bio.fill('First version.')
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(status).toBeVisible()

  // Starting another edit means the old message no longer describes what is on screen.
  await bio.fill('Second version, not yet saved.')
  await expect(status).toHaveCount(0)

  // A save that fails (someone else changed the profile meanwhile) must not leave, or show, a success message.
  await db().teamMember.update({ where: { id: card.id }, data: { bio: 'Changed behind the form.' } })
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /changed|reload/i })).toBeVisible()
  await expect(status).toHaveCount(0)
  expect((await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })).bio).toBe('Changed behind the form.')
  await admin.close()
})

test('Growth & Comms is flat and manageable through Team Members without changing permissions', async ({ browser }) => {
  test.setTimeout(180_000)
  const account = await createAccount('GROWTH', 'flat-growth')
  const card = await legacyCard('Growth Legacy', { role: 'Growth & Communications', publicTier: 'growth', order: 4000 })
  const peer = await legacyCard('Growth Lead', { role: 'Head of Growth', publicTier: null, order: 4001 })
  const admin = await withCookieConsentAnswered(await signedIn(browser, 'admin'))
  const page = await steadyPage(admin)
  await manage(await openMember(page, account))
  await page.getByLabel('Existing profile without an account').selectOption({ label: `${card.name}, Growth & Communications` })
  await page.getByRole('button', { name: 'Link profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Linked' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill(`${card.name} Edited`)
  await page.getByLabel('Public position', { exact: true }).fill('Growth & Communications')
  await page.getByLabel('Public placement', { exact: true }).selectOption('growth')
  await page.getByLabel('Display order', { exact: true }).fill('4002')
  await page.getByLabel('Biography', { exact: true }).fill('A completed Growth biography.')
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  const saved = await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })
  expect(saved).toMatchObject({ userId: account.id, publicTier: 'growth', order: 4002, bio: 'A completed Growth biography.' })
  expect(await db().teamMember.count({ where: { userId: account.id } })).toBe(1)
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('GROWTH')

  const publicContext = await browser.newContext()
  const publicPage = await steadyPage(publicContext)
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await publicPage.setViewportSize(viewport)
    await publicPage.goto('/team')
    const growth = publicPage.locator('section[aria-labelledby="team-growth"]')
    await expect(growth.getByRole('heading', { name: saved.name, exact: true })).toBeVisible()
    const ours = growth.locator(`[data-team-member-id="${peer.id}"], [data-team-member-id="${card.id}"]`)
    expect(await ours.evaluateAll(els => els.map(el => el.getAttribute('data-team-member-id')))).toEqual([peer.id, card.id])
    expect(new Set(await ours.evaluateAll(els => els.map(el => el.className))).size).toBe(1)
    const writerBox = await publicPage.locator('section[aria-labelledby="team-writers"]').boundingBox()
    const growthBox = await growth.boundingBox()
    expect(growthBox!.y).toBeGreaterThan(writerBox!.y + writerBox!.height)
    expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  // The member still cannot change appointment, placement, ownership or access.
  const own = await withCookieConsentAnswered(await signInAs(browser, account))
  for (const [key, value] of [['position', 'Editor-in-Chief'], ['publicTier', 'editor_in_chief'], ['role', 'ADMIN'], ['userId', 'other']]) {
    const res = await own.request.put('/api/team-profile', { multipart: { bio: 'Member bio', [key]: value } })
    expect(res.status()).toBe(400)
  }
  await own.close()

  await manage(await reloadMembers(page, account))
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await page.getByRole('button', { name: 'Hide from public page' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'is no longer on the Our Team page' })).toBeVisible()
  await publicPage.goto('/team')
  await expect(publicPage.locator(`[data-team-member-id="${card.id}"]`)).toHaveCount(0)
  await manage(await reloadMembers(page, account))
  await page.getByRole('tab', { name: 'Public profile' }).click()
  await page.getByLabel('Display order', { exact: true }).fill('3999')
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Publish profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'now appears on the Our Team page' })).toBeVisible()
  await publicPage.goto('/team')
  // Wait for the restored card before checking the new order.
  await expect(publicPage.locator(`[data-team-member-id="${card.id}"]`)).toBeVisible()
  const ids = await publicPage.locator('section[aria-labelledby="team-growth"] [data-team-member-id]').evaluateAll(els => els.map(el => el.getAttribute('data-team-member-id')))
  expect(ids.indexOf(card.id)).toBeLessThan(ids.indexOf(peer.id))
  await publicContext.close()

  await page.goto('/admin/testing')
  await expect(page.getByRole('heading', { name: 'Testing', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
  await admin.close()
})
