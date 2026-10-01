import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  PASSWORD,
  closeDb,
  db,
  email,
  resetTeamFixtures,
  type AccountKey,
} from './helpers/teamFixtures'
import { makePng, watch } from './helpers/e2eUtils'

/**
 * Team Profile, end to end, in a real browser against a production build, a local
 * Postgres and a local Supabase-Storage-compatible server. Run through
 * scripts/run-team-profile-e2e.sh (it builds the app against those and sets
 * E2E_TEAM_PROFILE=1). Tests run in order and share fixture state.
 */
test.describe.configure({ mode: 'serial' })

const STORAGE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'

let ids: Record<AccountKey, string>

test.beforeAll(async () => {
  ids = await resetTeamFixtures()
})
test.afterAll(closeDb)

// ── helpers ────────────────────────────────────────────────────────────────────

async function loginAs(
  browser: Browser,
  key: AccountKey,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, ...options })
  const page = await context.newPage()
  const errors = watch(page)
  await page.goto('/editorial/login')
  await page.locator('input[type="email"]').fill(email(key))
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  // NOT /editorial/ in general — that also matches /editorial/login itself.
  await page.waitForURL((url) => url.pathname.startsWith('/editorial') && !url.pathname.includes('/login'), { timeout: 20_000 })
  return { context, page, errors }
}

const cardCount = (userId: string) => db().teamMember.count({ where: { userId } })
const storageObjects = async (): Promise<{ key: string }[]> => (await fetch(`${STORAGE_URL}/__objects`)).json()
const sidebarLink = (page: Page) => page.getByRole('link', { name: 'Team Profile' })

async function openProfile(page: Page) {
  await page.goto('/editorial/team-profile')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

// ── who sees it ────────────────────────────────────────────────────────────────

test.describe('access by role', () => {
  for (const key of ['writer', 'editor', 'growth'] as const) {
    test(`${key} sees Team Profile in the portal sidebar and can open it`, async ({ browser }) => {
      const { context, page, errors } = await loginAs(browser, key)
      await expect(sidebarLink(page)).toBeVisible()
      await sidebarLink(page).click()
      await expect(page).toHaveURL(/\/editorial\/team-profile$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your team profile')
      expect(errors).toEqual([])
      await context.close()
    })
  }

  test('admin has no Team Profile link and gets an explanation, not a form', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'admin')
    await expect(sidebarLink(page)).toHaveCount(0)
    await openProfile(page)
    await expect(page.locator('p[role="alert"]')).toContainText(/isn.t assigned to the Writing, Editorial or Growth/)
    await expect(page.locator('form')).toHaveCount(0)
    await context.close()
  })

  test('a reader cannot enter the portal at all', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'reader').catch(() => {
      throw new Error('reader login failed')
    })
    await page.goto('/editorial/team-profile')
    await expect(page.getByText('Access Denied')).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)
    await context.close()
  })

  test('an account with no name is asked to set one first', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'noname')
    await openProfile(page)
    await expect(page.locator('p[role="alert"]')).toContainText('Add your name')
    await context.close()
  })
})

// ── the create → edit flow ────────────────────────────────────────────────────

test.describe('writer: create then edit', () => {
  let context: BrowserContext
  let page: Page
  let errors: string[]

  test.beforeAll(async ({ browser }) => {
    ;({ context, page, errors } = await loginAs(browser, 'writer'))
  })
  test.afterAll(async () => {
    await context.close()
  })

  test('create state: name and team are shown as read-only text, with no team picker', async () => {
    await openProfile(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your team profile')
    await expect(page.locator('form').getByText('Wendy Writer', { exact: true })).toBeVisible()
    await expect(page.locator('form').getByText('Writing', { exact: true })).toBeVisible()
    await expect(page.locator('form').getByText('Set by your role')).toBeVisible()
    // Nothing for the user to edit or choose:
    await expect(page.locator('select')).toHaveCount(0)
    await expect(page.locator('input[value="Wendy Writer"], input[value="Writing"]')).toHaveCount(0)
    await expect(page.locator('input:not([type="file"]):not([type="hidden"])')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create profile' })).toBeEnabled()
    // placeholder, not a broken image
    await expect(page.locator('form img')).toHaveCount(0)
    await expect(page.locator('form').getByText('WW', { exact: true })).toBeVisible()
  })

  test('the description counter tracks input and the field stops at the limit', async () => {
    const bio = page.getByLabel('Description')
    await expect(page.locator('form').getByText('0/600')).toBeVisible()
    await bio.fill('Hello there')
    await expect(page.locator('form').getByText('11/600')).toBeVisible()
    await bio.fill('x'.repeat(700))
    await expect(page.locator('form').getByText('600/600')).toBeVisible()
    await expect(bio).toHaveValue('x'.repeat(600))
    await bio.fill('')
  })

  test('photo validation: an oversize file is refused in the browser, with a clear message', async () => {
    const big = Buffer.concat([makePng(), Buffer.alloc(4 * 1024 * 1024)])
    const before = (await storageObjects()).length
    await page.setInputFiles('#tp-photo', { name: 'big.png', mimeType: 'image/png', buffer: big })
    await expect(page.getByRole('status')).toContainText('too large (max 4 MB)')
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0)
    expect((await storageObjects()).length).toBe(before)
    expect(await cardCount(ids.writer)).toBe(0)
  })

  test('photo validation: a non-image with an image name is refused by the server', async () => {
    await page.setInputFiles('#tp-photo', { name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>') })
    await page.getByLabel('Description').fill('should not be saved')
    await page.getByRole('button', { name: 'Create profile' }).click()
    await expect(page.getByRole('status')).toContainText('JPEG, PNG, GIF, WebP or AVIF')
    expect(await cardCount(ids.writer)).toBe(0)
    expect((await storageObjects()).filter((o) => o.key.startsWith(`avatars/${ids.writer}/`))).toHaveLength(0)
  })

  test('selecting a photo previews it, and Remove clears the selection', async () => {
    await page.setInputFiles('#tp-photo', { name: 'me.png', mimeType: 'image/png', buffer: makePng() })
    await expect(page.getByAltText('New profile photo preview')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByAltText('New profile photo preview')).toHaveCount(0)
    await expect(page.locator('form').getByText('WW', { exact: true })).toBeVisible()
  })

  test('saving locks the form, a double-click sends ONE request, and one card exists', async () => {
    await page.reload()
    await page.route('**/api/team-profile', async (route) => {
      await new Promise((r) => setTimeout(r, 700)) // hold the response so the saving state is observable
      await route.continue()
    })
    const puts: string[] = []
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/api/team-profile') && puts.push(r.url()))

    await page.setInputFiles('#tp-photo', { name: 'me.png', mimeType: 'image/png', buffer: makePng() })
    await page.getByLabel('Description').fill('I cover monetary policy.')
    const save = page.getByRole('button', { name: 'Create profile' })
    await save.dblclick()

    await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await expect(page.getByLabel('Description')).toBeDisabled()
    await expect(page.getByRole('status')).toContainText('has been saved')
    await page.unroute('**/api/team-profile')
    // …and it stays: the refresh the form triggers must not remount it and wipe the message.
    await page.waitForTimeout(1200)
    await expect(page.getByRole('status')).toContainText('has been saved')

    expect(puts).toHaveLength(1)
    expect(await cardCount(ids.writer)).toBe(1)
    expect(await db().teamMember.count({ where: { name: 'Wendy Writer' } })).toBe(1)
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    // the page reflects the persisted profile straight away — no manual refresh needed
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your team profile')
  })

  test('after a refresh the persisted profile is shown in the edit state', async () => {
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your team profile')
    await expect(page.getByLabel('Description')).toHaveValue('I cover monetary policy.')
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create profile' })).toHaveCount(0)
    const img = page.locator('form img').first()
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  })

  test('editing the description updates the same row', async () => {
    const before = await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })
    await page.getByLabel('Description').fill('Now I cover fiscal policy.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    const after = await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })
    expect(after.id).toBe(before.id)
    expect(after.bio).toBe('Now I cover fiscal policy.')
    expect(after.image).toBe(before.image)
    expect(await cardCount(ids.writer)).toBe(1)
  })

  test('replacing the photo stores the new file and deletes the old one', async () => {
    const before = await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })
    await page.setInputFiles('#tp-photo', { name: 'new.png', mimeType: 'image/png', buffer: makePng(64, [20, 90, 200]) })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    const after = await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })
    expect(after.image).not.toBe(before.image)
    expect((await fetch(after.image!)).status).toBe(200)
    expect((await fetch(before.image!)).status).toBe(404)
    expect((await storageObjects()).filter((o) => o.key.startsWith(`avatars/${ids.writer}/`))).toHaveLength(1)
  })

  test('the public page shows them once, under Writers, with a rendered photo', async ({ browser }) => {
    const anon = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
    const pub = await anon.newPage()
    const pubErrors = watch(pub)
    await pub.goto('/team')
    const writers = pub.locator('section[aria-labelledby="team-writers"]')
    await expect(writers.getByRole('heading', { level: 3, name: 'Wendy Writer' })).toHaveCount(1)
    await expect(pub.getByRole('heading', { level: 3, name: 'Wendy Writer' })).toHaveCount(1)
    // `.group` is the card. `:visible` matters: while Next streams the page, a hidden
    // copy of the server HTML briefly coexists with the live tree (then is removed).
    const img = writers.locator('div.group img[alt^="Wendy Writer"]:visible')
    await img.scrollIntoViewIfNeeded()
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
    expect(pubErrors).toEqual([])
    await anon.close()
  })

  test('removing the photo clears it everywhere and the card falls back to initials', async ({ browser }) => {
    const before = await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })
    await page.reload()
    await page.getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    expect((await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })).image).toBeNull()
    expect((await fetch(before.image!)).status).toBe(404)

    const anon = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
    const pub = await anon.newPage()
    await pub.goto('/team')
    const card = pub.locator('section[aria-labelledby="team-writers"]').locator('div.group', { has: pub.getByRole('heading', { name: 'Wendy Writer' }) })
    await expect(card.getByText('WW')).toBeVisible()
    await expect(card.locator('img')).toHaveCount(0)
    await anon.close()
    // and restore a photo for the later public-page assertions
    await page.setInputFiles('#tp-photo', { name: 'again.png', mimeType: 'image/png', buffer: makePng(64, [40, 160, 90]) })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
  })

  test('no console errors or page exceptions occurred during the whole flow', () => {
    // The one entry allowed is the browser's own log of the deliberate 400 from the
    // non-image upload test above; anything else — or a second one — fails.
    expect(errors).toEqual([
      'Failed to load resource: the server responded with a status of 400 (Bad Request) @ ' +
        `${process.env.E2E_BASE_URL}/api/team-profile`,
    ])
  })
})

// ── editor / growth ───────────────────────────────────────────────────────────

test.describe('other teams', () => {
  test('two tabs creating at the same moment still produce exactly one card', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'editor')
    const second = await context.newPage()
    await openProfile(page)
    await openProfile(second)
    await expect(page.locator('form').getByText('Editorial', { exact: true })).toBeVisible()
    await page.getByLabel('Description').fill('Tab one')
    await second.getByLabel('Description').fill('Tab two')
    await Promise.all([
      page.getByRole('button', { name: 'Create profile' }).click(),
      second.getByRole('button', { name: 'Create profile' }).click(),
    ])
    await expect(page.getByRole('status')).toContainText('has been saved')
    await expect(second.getByRole('status')).toContainText('has been saved')
    expect(await cardCount(ids.editor)).toBe(1)
    expect(await db().teamMember.count({ where: { name: 'Edgar Editor' } })).toBe(1)
    await context.close()
  })

  test('growth creates a card that appears in Growth & Communications', async ({ browser }) => {
    const { context, page, errors } = await loginAs(browser, 'growth')
    await openProfile(page)
    await expect(page.locator('form').getByText('Growth & Communications', { exact: true })).toBeVisible()
    await page.getByLabel('Description').fill('I run our newsletter and socials.')
    await page.getByRole('button', { name: 'Create profile' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    expect(await cardCount(ids.growth)).toBe(1)
    expect(errors).toEqual([])
    await context.close()
  })
})

// ── people who already have a card ────────────────────────────────────────────

test.describe('existing members', () => {
  test('a legacy card with no email is NOT duplicated: the member is told to ask an admin', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'legacy')
    await openProfile(page)
    await expect(page.locator('p[role="alert"]')).toContainText(/already exists but isn.t linked/)
    await expect(page.locator('form')).toHaveCount(0)

    // and the API refuses too, if someone calls it directly
    const res = await page.request.put('/api/team-profile', { multipart: { bio: 'duplicate attempt' } })
    expect(res.status()).toBe(409)
    expect((await res.json()).code).toBe('LEGACY_CARD_NEEDS_LINK')
    expect(await cardCount(ids.legacy)).toBe(0)
    expect(await db().teamMember.count({ where: { name: 'Lena Legacy' } })).toBe(1)
    await context.close()
  })

  test('a card carrying the member’s email opens in the edit state, prefilled, and saving adopts it', async ({ browser }) => {
    const legacyCard = await db().teamMember.findFirstOrThrow({ where: { email: email('adopt') } })
    const { context, page } = await loginAs(browser, 'adopt')
    await openProfile(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your team profile')
    await expect(page.getByLabel('Description')).toHaveValue('Alan’s old bio.')
    await page.getByLabel('Description').fill('Alan’s new bio.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    const rows = await db().teamMember.findMany({ where: { userId: ids.adopt } })
    expect(rows.map((r) => r.id)).toEqual([legacyCard.id])
    expect(rows[0]).toMatchObject({ role: 'Writer', order: 21, bio: 'Alan’s new bio.' })
    await context.close()
  })

  test('an already-linked member starts in the edit state', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'linked')
    await openProfile(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your team profile')
    await expect(page.getByLabel('Description')).toHaveValue('Linda’s existing bio.')
    await expect(page.locator('form img').first()).toBeVisible()
    await context.close()
  })
})

// ── admin linking, in the browser ─────────────────────────────────────────────

test.describe('admin: Linked account control', () => {
  test('offers only Writer, Editor and Growth accounts, and linking makes the member edit their card', async ({ browser }) => {
    const card = await db().teamMember.findFirstOrThrow({ where: { name: 'Lena Legacy', userId: null } })
    const { context, page } = await loginAs(browser, 'admin')
    await page.goto('/admin/team')
    await page.getByRole('button', { name: 'Edit Lena Legacy' }).click()

    const select = page.getByLabel('Linked account')
    const options = await select.locator('option').allTextContents()
    const joined = options.join('\n')
    expect(joined).toContain(email('legacy'))
    expect(joined).toContain(email('noname')) // a Writer with no card yet
    // Not offered: admin and reader accounts, and accounts that already own a card.
    expect(joined).not.toContain(email('writer'))
    expect(joined).not.toContain(email('admin'))
    expect(joined).not.toContain(email('reader'))
    expect(joined).not.toContain(email('linked'))
    // The form has no team control at all: the role decides.
    await expect(page.getByLabel(/^team$/i)).toHaveCount(0)

    await select.selectOption(ids.legacy)
    await page.getByRole('button', { name: 'Save Member' }).click()
    await expect(page.getByText('Edit Member', { exact: true })).toHaveCount(0) // the form closes only after a successful save
    expect((await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })).userId).toBe(ids.legacy)
    await context.close()

    // Lena's first visit now edits that same card.
    const lena = await loginAs(browser, 'legacy')
    await openProfile(lena.page)
    await expect(lena.page.getByRole('heading', { level: 1 })).toHaveText('Edit your team profile')
    await expect(lena.page.getByLabel('Description')).toHaveValue('Lena’s admin-entered bio.')
    await lena.page.getByLabel('Description').fill('Lena’s own words.')
    await lena.page.getByRole('button', { name: 'Save changes' }).click()
    await expect(lena.page.getByRole('status')).toContainText('has been saved')
    const rows = await db().teamMember.findMany({ where: { userId: ids.legacy } })
    expect(rows.map((r) => r.id)).toEqual([card.id])
    expect(rows[0]).toMatchObject({ role: 'Senior Editor', order: 20, bio: 'Lena’s own words.' })
    expect(await db().teamMember.count({ where: { name: 'Lena Legacy' } })).toBe(1)
    await lena.context.close()
  })

  test('the API refuses an admin, a reader or a second card for one account', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'admin')
    const card = await db().teamMember.create({ data: { name: 'Throwaway Card', role: 'Writer', order: 99 } })
    const put = (userId: string) =>
      page.request.put(`/api/team/${card.id}`, { data: { name: 'Throwaway Card', role: 'Writer', userId } })
    expect((await put(ids.admin)).status()).toBe(400)
    expect((await put(ids.reader)).status()).toBe(400)
    expect((await put(ids.writer)).status()).toBe(409) // Wendy already owns a card
    expect((await db().teamMember.findUniqueOrThrow({ where: { id: card.id } })).userId).toBeNull()
    await db().teamMember.delete({ where: { id: card.id } })
    await context.close()
  })
})

// ── the API, called directly ──────────────────────────────────────────────────

test.describe('API authorisation', () => {
  test('an unauthenticated caller cannot modify anything', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL })
    const before = await db().teamMember.count()
    const res = await anon.put('/api/team-profile', { multipart: { bio: 'x' } })
    expect(res.status()).toBe(401)
    expect(await db().teamMember.count()).toBe(before)
    await anon.dispose()
  })

  for (const key of ['reader', 'admin'] as const) {
    test(`a ${key} account is refused`, async ({ browser }) => {
      const { context, page } = await loginAs(browser, key)
      const res = await page.request.put('/api/team-profile', { multipart: { bio: 'x' } })
      expect(res.status()).toBe(403)
      expect(await cardCount(ids[key])).toBe(0)
      await context.close()
    })
  }

  test('forged userId / team / role fields change nothing about anyone', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'writer')
    const editorBefore = await db().teamMember.findUniqueOrThrow({ where: { userId: ids.editor } })
    const res = await page.request.put('/api/team-profile', {
      multipart: { bio: 'forged', team: 'editorial', role: 'EDITOR', userId: ids.editor, order: '-1', isActive: 'false' },
    })
    expect(res.status()).toBe(200)
    expect(await db().teamMember.findUniqueOrThrow({ where: { userId: ids.editor } })).toEqual(editorBefore)
    expect((await db().user.findUniqueOrThrow({ where: { id: ids.writer } })).role).toBe('WRITER')
    expect(await db().teamMember.findUniqueOrThrow({ where: { userId: ids.writer } })).toMatchObject({ role: '', isActive: true, bio: 'forged' })
    await context.close()
  })
})

// ── the public page ───────────────────────────────────────────────────────────

test.describe('public Our Team page', () => {
  test('sections are right, every person appears exactly once, and every photo renders', async ({ browser }) => {
    const anon = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
    const page = await anon.newPage()
    const errors = watch(page)
    await page.goto('/team')
    await page.waitForLoadState('networkidle') // streaming leaves a hidden copy of the HTML until hydration

    const names = (section: string) =>
      page.locator(`section[aria-labelledby="team-${section}"] h3:visible`).allTextContents()

    // The masthead holds only LEGACY cards with no account (their title is all there is to
    // place them by). An untitled member sorts after a titled one — existing behaviour.
    expect(await names('masthead')).toEqual(['Julia Stepniak', 'Lucas Dwyer'])
    // The Editor-in-Chief's account is an EDITOR, so they lead the Editorial section.
    const editorialNames = await names('editorial')
    expect(editorialNames[0]).toBe('Alexander Escala')
    expect([...editorialNames].sort()).toEqual(['Alexander Escala', 'Annika Sarawgi', 'Edgar Editor', 'Lena Legacy', 'Linda Linked', 'Sam Hunt', 'Satvik Singla'])
    await expect(page.locator('section[aria-labelledby="team-editorial"] h3:visible', { hasText: 'Alexander Escala' })).toHaveCount(1)
    // Alan is shown under his ACCOUNT name, not the legacy card's old spelling.
    // Mira has an Editor-in-Chief TITLE on a WRITER account: she is a writer. The title never moves her.
    expect((await names('writers')).sort()).toEqual(['Alan Adopt', 'Catherine Toh', 'Gurmehar Kaur', 'Mira Mismatch', 'Wendy Writer', 'Yaoqing Wang', 'Zara Spendiff'])
    await expect(page.locator('section[aria-labelledby="team-writers"]', { hasText: 'Mira Mismatch' }).getByText('Editor-in-Chief')).toBeVisible()
    expect(await names('growth')).toEqual(['Grace Growth'])
    await expect(page.getByRole('heading', { level: 2, name: 'Growth & Communications' })).toBeVisible()

    // Hierarchy inside Editorial survives linking: Senior before Junior.
    expect(editorialNames.indexOf('Annika Sarawgi')).toBeLessThan(editorialNames.indexOf('Sam Hunt'))

    const all = await page.locator('section[aria-labelledby^="team-"] h3:visible').allTextContents()
    expect(all).toHaveLength(new Set(all).size)
    expect(all).toHaveLength(17)

    // every card photo (legacy /team/*.png and uploaded) really renders
    const imgs = page.locator('section div.group img:visible')
    const count = await imgs.count()
    expect(count).toBeGreaterThanOrEqual(13)
    for (let i = 0; i < count; i++) await imgs.nth(i).scrollIntoViewIfNeeded()
    await expect
      .poll(() => imgs.evaluateAll((els) => (els as HTMLImageElement[]).filter((e) => !(e.complete && e.naturalWidth > 0)).map((e) => e.alt)))
      .toEqual([])
    expect(errors).toEqual([])
    await anon.close()
  })

  test('a banned or demoted member disappears, and returns with the same card when restored', async ({ browser }) => {
    const anon = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
    const page = await anon.newPage()
    await db().user.update({ where: { id: ids.growth }, data: { role: 'READER' } })
    await page.goto('/team')
    await expect(page.getByRole('heading', { level: 3, name: 'Grace Growth' })).toHaveCount(0)
    await expect(page.locator('section[aria-labelledby="team-growth"]')).toHaveCount(0) // empty team: no empty section
    await db().user.update({ where: { id: ids.growth }, data: { role: 'GROWTH' } })
    await page.goto('/team')
    await expect(page.getByRole('heading', { level: 3, name: 'Grace Growth' })).toHaveCount(1)
    await anon.close()
  })

  test('the public team API does not leak account links', async ({ request }) => {
    const rows = (await (await request.get('/api/team')).json()) as Record<string, unknown>[]
    expect(rows.length).toBeGreaterThan(10)
    for (const row of rows) expect(row).not.toHaveProperty('userId')
  })
})

// ── layout ────────────────────────────────────────────────────────────────────

test.describe('layout', () => {
  test('desktop: the sidebar stays put and the form sits beside it, not under it', async ({ browser }) => {
    const { context, page } = await loginAs(browser, 'linked', { viewport: { width: 1280, height: 800 } })
    await openProfile(page)
    const nav = await page.getByRole('navigation', { name: 'Editorial navigation' }).boundingBox()
    const form = await page.locator('form').boundingBox()
    expect(nav).not.toBeNull()
    expect(form!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width - 1)
    await expect(sidebarLink(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Decline' }).click().catch(() => {})
    await page.waitForTimeout(800) // let the portal's fade-in finish before the screenshot
    await page.screenshot({ path: 'test-results/team-profile-desktop.png', fullPage: true })
    await context.close()
  })

  test('mobile: reachable from the menu, usable, and nothing overflows the screen', async ({ browser }) => {
    const { context, page, errors } = await loginAs(browser, 'linked', { viewport: { width: 375, height: 740 } })
    await page.goto('/editorial')
    // First-visit cookie banner is fixed to the bottom and covers Save on a phone until dismissed.
    await page.getByRole('button', { name: 'Decline' }).click()
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await sidebarLink(page).click()
    await expect(page).toHaveURL(/\/editorial\/team-profile$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your team profile')

    for (const control of [page.getByLabel('Description'), page.getByRole('button', { name: 'Save changes' }), page.getByText('Change photo')]) {
      await control.scrollIntoViewIfNeeded()
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(376)
      expect(box.height).toBeGreaterThanOrEqual(30)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByLabel('Description').fill('Edited on a phone.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    // success reads as success: settles on green (not the error red)
    await expect
      .poll(() =>
        page.getByRole('status').evaluate((el) => {
          const ctx = document.createElement('canvas').getContext('2d')!
          ctx.fillStyle = getComputedStyle(el).color
          ctx.fillRect(0, 0, 1, 1)
          const [r, g] = ctx.getImageData(0, 0, 1, 1).data
          return g - r
        }),
      )
      .toBeGreaterThan(40)
    await page.screenshot({ path: 'test-results/team-profile-mobile.png', fullPage: true })
    expect(errors).toEqual([])
    await context.close()
  })

  test('mobile: the public Our Team page fits the screen', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 375, height: 740 } })
    const page = await context.newPage()
    await page.goto('/team')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('heading', { level: 2, name: 'Growth & Communications' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/team-public-mobile.png', fullPage: true })
    await context.close()
  })

  test('desktop: public page screenshot for the record', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    await page.goto('/team')
    await page.getByRole('heading', { level: 2, name: 'Growth & Communications' }).scrollIntoViewIfNeeded()
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: 'test-results/team-public-desktop.png', fullPage: true })
    await context.close()
  })
})
