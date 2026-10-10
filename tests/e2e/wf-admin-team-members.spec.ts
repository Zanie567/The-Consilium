import { test, expect, type Browser, type Page } from '@playwright/test'
import { closeDb, createAccount, db, hydrated, removeMyAccounts, signInAs, signedIn, type TestAccount } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

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
    const page = await context.newPage()
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

async function openMember(page: Page, account: TestAccount) {
  await page.goto('/editorial/members')
  await expect(page.getByRole('heading', { name: 'Team Members', level: 1 })).toBeVisible()
  // The site sets `scroll-behavior: smooth` on <html>. Playwright scrolls the Manage button into view and clicks it
  // while that animation is still running; on a loaded WebKit the button moves between mousedown and mouseup, so the
  // button is focused but no click is delivered and the panel never opens. Make the scroll instant for this page.
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important }' })
  const search = page.getByLabel('Search')
  await hydrated(search, 'onChange')
  await search.fill(account.email)
  const row = page.getByTestId(`member-${account.email}`)
  await expect(row).toBeVisible()
  return row
}

test('assigning an existing profile to a new account: nothing is lost, the owner can then edit it, the public page follows', async ({ browser }) => {
  test.setTimeout(180_000)
  const account = await createAccount('WRITER', 'newhire')
  const card = await legacyCard('Assign', { email: null })
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
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
  const own = await signInAs(browser, account)
  const ownPage = await own.newPage()
  await ownPage.goto('/editorial/team-profile')
  await ownPage.getByLabel('Description').fill('Now in my own words.')
  await ownPage.getByRole('button', { name: 'Save changes' }).click()
  await expect(ownPage.getByRole('status').filter({ hasText: 'has been saved' })).toBeVisible()
  const edited = await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })
  expect(edited).toMatchObject({ bio: 'Now in my own words.', role: 'Staff Writer', order: 4000, userId: account.id })
  expect((await ownPage.request.get('/api/admin/team-members')).status()).toBe(403)
  await own.close()

  expect((await publicTeam(browser))).toContain('Now in my own words.')

  // Admin changes the PUBLIC position; the access role is untouched.
  await page.reload()
  await page.getByLabel('Search').fill(account.email)
  await page.getByTestId(`member-${account.email}`).getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: 'Public profile' }).click()
  const position = page.getByLabel('Public position', { exact: true })
  await expect(position).toHaveValue('Staff Writer')
  await position.fill('Senior Contributor')
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('WRITER')
  await page.reload()
  await page.getByLabel('Search').fill(account.email)
  await expect(page.getByTestId(`member-${account.email}`)).toContainText('Senior Contributor') // persisted after reload
  expect(await publicTeam(browser)).toContain('Senior Contributor')

  // ...and changing the ACCESS role leaves the public title alone.
  await page.getByTestId(`member-${account.email}`).getByRole('button', { name: 'Manage' }).click()
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

test('creating a new profile for an account links it, starts hidden, and goes public only when shown', async ({ browser }) => {
  test.setTimeout(150_000)
  const account = await createAccount('EDITOR', 'create')
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
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
  await page.getByLabel('Show on Our Team page').check()
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  expect(await publicTeam(browser)).toContain(name)

  // Hide again, then delete: the public page follows both, the account is untouched.
  await page.getByLabel('Show on Our Team page').uncheck()
  await page.getByRole('button', { name: 'Save public details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  expect(await publicTeam(browser)).not.toContain(name)
  await page.getByRole('button', { name: 'Delete profile' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete profile' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile deleted' })).toBeVisible()
  expect(await db().teamMember.count({ where: { userId: account.id } })).toBe(0)
  expect((await db().user.findUniqueOrThrow({ where: { id: account.id } })).role).toBe('EDITOR')
  await admin.close()
})

test('a second profile with the same name needs an explicit confirmation', async ({ browser }) => {
  test.setTimeout(90_000)
  const existing = await legacyCard('Twin')
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
  await page.goto('/editorial/members')
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
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
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
    const context = await signedIn(browser, who)
    const page = await context.newPage()
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
  const admin = await signedIn(browser, 'admin')
  const first = await admin.newPage()
  const second = await admin.newPage()
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
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
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
  const admin = await signedIn(browser, 'admin')
  const page = await admin.newPage()
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
