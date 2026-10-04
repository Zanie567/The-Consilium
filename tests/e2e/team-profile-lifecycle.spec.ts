import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { closeDb, db } from './helpers/teamFixtures'
import { makePng, watch } from './helpers/e2eUtils'

/**
 * The account lifecycle, with genuinely NEW accounts created through the normal
 * sign-up form and promoted through the normal admin screen — nothing is pre-seeded
 * with a role except the administrator doing the promoting.
 *
 *   sign up (READER) → admin grants a role → member creates their own profile
 *   → the appointment survives later permission changes without ever being duplicated.
 *
 * Run through scripts/run-team-profile-e2e.sh. Tests run in order.
 */
test.describe.configure({ mode: 'serial' })

const DOMAIN = '@lifecycle.consilium.test'
const ADMIN_EMAIL = `lifecycle-admin${DOMAIN}`
const PASSWORD = 'lifecycle-pass-1234'

type Role = 'READER' | 'WRITER' | 'EDITOR' | 'GROWTH' | 'ADMIN'
type SectionId = 'masthead' | 'editorial' | 'writers' | 'growth' | 'wider'
const SECTIONS: SectionId[] = ['masthead', 'editorial', 'writers', 'growth', 'wider']
const TEAM_LABEL = { WRITER: 'Writer', EDITOR: 'Editor', GROWTH: 'Growth & Communications' } as const

let adminContext: BrowserContext
let adminPage: Page

test.beforeAll(async ({ browser }) => {
  await db().user.deleteMany({ where: { email: { endsWith: DOMAIN } } })
  await db().user.create({
    data: { email: ADMIN_EMAIL, name: 'Lifecycle Admin', role: 'ADMIN', password: await bcrypt.hash(PASSWORD, 10), emailVerified: new Date() },
  })
  adminContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
  adminPage = await adminContext.newPage()
  await adminPage.goto('/editorial/login')
  await adminPage.locator('input[type="email"]').fill(ADMIN_EMAIL)
  await adminPage.locator('input[type="password"]').fill(PASSWORD)
  await adminPage.locator('button[type="submit"]').click()
  await adminPage.waitForURL((u) => u.pathname.startsWith('/editorial') && !u.pathname.includes('/login'))
})
test.afterAll(async () => {
  await db().user.deleteMany({ where: { email: { endsWith: DOMAIN } } })
  await adminContext?.close()
  await closeDb()
})

// ── helpers ────────────────────────────────────────────────────────────────────

/** The normal sign-up path: the public form. It signs the new account in. */
async function signUp(browser: Browser, name: string, email: string) {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
  const page = await context.newPage()
  const errors = watch(page)
  await page.goto('/signup')
  await page.getByPlaceholder('Your name').fill(name)
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('At least 8 characters').fill(PASSWORD)
  await page.locator('input[type="checkbox"]').check()
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 })
  const user = await db().user.findUniqueOrThrow({ where: { email } })
  return { context, page, errors, user }
}

/** The normal admin workflow: the Role selector on the user's page in the editorial portal. */
async function grantRole(userId: string, role: Role) {
  await adminPage.goto(`/editorial/users/${userId}`)
  const select = adminPage.locator('select', { has: adminPage.locator('option[value="GROWTH"]') }).first()
  await select.selectOption(role)
  await expect(adminPage.getByText('Saved.', { exact: true })).toBeVisible()
  expect((await db().user.findUniqueOrThrow({ where: { id: userId } })).role).toBe(role)
}

const sessionRole = async (page: Page): Promise<string> => (await (await page.request.get('/api/auth/session')).json()).user?.role
const cards = (userId: string) => db().teamMember.findMany({ where: { userId } })
const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const sidebarLink = (page: Page) => page.getByRole('link', { name: 'Team Profile' })

/** Every public section this person's card appears in, and how many times in total. */
async function publicPlacement(browser: Browser, name: string): Promise<{ sections: SectionId[]; total: number }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
  const page = await context.newPage()
  await page.goto('/team')
  await page.waitForLoadState('networkidle')
  const sections: SectionId[] = []
  let total = 0
  for (const id of SECTIONS) {
    const n = await page.locator(`section[aria-labelledby="team-${id}"] h3:visible`, { hasText: new RegExp(`^${name}$`) }).count()
    if (n > 0) sections.push(id)
    total += n
  }
  await context.close()
  return { sections, total }
}

async function dismissCookies(page: Page) {
  await page.getByRole('button', { name: 'Decline' }).click({ timeout: 1500 }).catch(() => {})
}

// ── new account → promotion → profile, for each of the three roles ────────────

for (const [role, section] of [
  ['WRITER', 'writers'],
  ['EDITOR', 'editorial'],
  ['GROWTH', 'growth'],
] as const) {
  test(`new account → admin grants ${role} → creates a profile in ${section}`, async ({ browser }) => {
    test.setTimeout(90_000)
    const name = `Newcomer ${role.toLowerCase()}`
    const { context, page, errors, user } = await signUp(browser, name, `new-${role.toLowerCase()}${DOMAIN}`)
    await dismissCookies(page)

    // 2. defaults: a plain reader, with no card and nothing created for them
    expect(user.role).toBe('READER')
    expect(await cards(user.id)).toHaveLength(0)
    expect(await sessionRole(page)).toBe('READER')

    // 3. not available before promotion
    await page.goto('/editorial/team-profile')
    await expect(page.getByText('Access Denied')).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)
    await expect(sidebarLink(page)).toHaveCount(0)
    const denied = await page.request.put('/api/team-profile', { multipart: { bio: 'let me in' } })
    expect(denied.status()).toBe(403)
    expect(await cards(user.id)).toHaveLength(0)
    // …and they cannot grant themselves anything, by either role route
    expect((await page.request.patch(`/api/editorial/users/${user.id}`, { data: { role } })).status()).toBe(403)
    expect((await page.request.patch(`/api/admin/users/${user.id}/role`, { data: { role } })).status()).toBe(403)
    expect((await page.request.patch('/api/profile/account', { data: { bio: 'hi', role } })).status()).toBe(200)
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('READER') // role in the body was ignored

    // 4. the normal admin workflow — nothing else is done for them
    await grantRole(user.id, role)

    // 5/6. the SAME session, no sign-in: one reload and the portal recognises the role
    await page.goto('/editorial/team-profile')
    await expect(heading(page)).toHaveText('Create your team profile')
    await expect(sidebarLink(page)).toBeVisible()

    // 7. team derived from the role; nothing to choose
    await expect(page.locator('form').getByText(TEAM_LABEL[role], { exact: true })).toBeVisible()
    await expect(page.locator('select')).toHaveCount(0)

    // 8. create
    await page.setInputFiles('#tp-photo', { name: 'me.png', mimeType: 'image/png', buffer: makePng(64, [30, 120, 200]) })
    await page.getByLabel('Description').fill(`I am the new ${role.toLowerCase()}.`)
    await page.getByRole('button', { name: 'Create profile' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')

    // 9. exactly one row, owned by this account
    const rows = await cards(user.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: user.id, name, bio: `I am the new ${role.toLowerCase()}.` })
    expect(rows[0].image).toContain(`/avatars/${user.id}/`)
    expect(await db().teamMember.count({ where: { name } })).toBe(1)

    // 10. on the public page exactly once, in the right section
    expect(await publicPlacement(browser, name)).toEqual({ sections: [section], total: 1 })

    // 11. a refresh shows the edit state
    await page.reload()
    await expect(heading(page)).toHaveText('Edit your team profile')
    await expect(page.getByLabel('Description')).toHaveValue(`I am the new ${role.toLowerCase()}.`)

    // 12. edit bio and photo: the same row, no new one
    await page.getByLabel('Description').fill('Edited bio.')
    await page.setInputFiles('#tp-photo', { name: 'new.png', mimeType: 'image/png', buffer: makePng(64, [200, 120, 30]) })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('has been saved')
    const after = await cards(user.id)
    expect(after.map((r) => r.id)).toEqual([rows[0].id])
    expect(after[0].bio).toBe('Edited bio.')
    expect(after[0].image).not.toBe(rows[0].image)
    expect(await db().teamMember.count({ where: { name } })).toBe(1)
    expect((await fetch(rows[0].image!)).status).toBe(404) // the replaced photo is gone
    expect((await fetch(after[0].image!)).status).toBe(200)
    expect(await publicPlacement(browser, name)).toEqual({ sections: [section], total: 1 })

    // only the one deliberate failure the test provokes may appear in the console
    expect(errors.filter((e) => !/status of (400|403) /.test(e))).toEqual([])
    await context.close()
  })
}

// ── what the NextAuth session does ────────────────────────────────────────────

test('session: server checks see a promotion immediately; the cached JWT role catches up within a minute, with no re-login', async ({ browser }) => {
  test.setTimeout(150_000)
  const { context, page, user } = await signUp(browser, 'Newcomer session', `session${DOMAIN}`)
  await dismissCookies(page)
  expect(await sessionRole(page)).toBe('READER')

  await grantRole(user.id, 'WRITER')
  const grantedAt = Date.now()

  // Immediately: the portal layout, the page and the API all read the role from the database.
  await page.goto('/editorial/team-profile')
  await expect(heading(page)).toHaveText('Create your team profile')
  const created = await page.request.put('/api/team-profile', { multipart: { bio: 'immediately' } })
  expect(created.status()).toBe(201)

  // The role cached inside the JWT cookie is refreshed from the database at most once a minute.
  const immediate = await sessionRole(page)
  let convergedAfterMs: number | null = null
  for (let waited = 0; waited < 90_000; waited += 5_000) {
    if ((await sessionRole(page)) === 'WRITER') {
      convergedAfterMs = Date.now() - grantedAt
      break
    }
    await page.waitForTimeout(5_000)
  }
  const finding = `JWT role right after the grant: ${immediate}; converged to WRITER after ${convergedAfterMs === null ? 'NEVER' : Math.round(convergedAfterMs / 1000) + 's'} without signing in again`
  test.info().annotations.push({ type: 'session', description: finding })
  console.warn(`[session] ${finding}`)
  expect(convergedAfterMs, 'JWT role never caught up').not.toBeNull()
  expect(convergedAfterMs!).toBeLessThan(90_000)
  await context.close()
})

// ── role changes after a profile exists ───────────────────────────────────────

test('one account, one card: Writer → Editor → Growth → Reader → Writer → Admin → Editor', async ({ browser }) => {
  test.setTimeout(240_000)
  const name = 'Newcomer chain'
  const { context, page, user } = await signUp(browser, name, `chain${DOMAIN}`)
  await dismissCookies(page)

  await grantRole(user.id, 'WRITER')
  await page.goto('/editorial/team-profile')
  await page.setInputFiles('#tp-photo', { name: 'me.png', mimeType: 'image/png', buffer: makePng(64, [90, 40, 160]) })
  await page.getByLabel('Description').fill('chain bio')
  await page.getByRole('button', { name: 'Create profile' }).click()
  await expect(page.getByRole('status')).toContainText('has been saved')
  const [original] = await cards(user.id)
  const expectedBio = 'chain bio'

  const sameCard = async () => {
    const rows = await cards(user.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: original.id, userId: user.id, bio: expectedBio, image: original.image })
    expect(await db().teamMember.count({ where: { name } })).toBe(1)
  }

  for (const role of ['WRITER', 'EDITOR', 'GROWTH', 'ADMIN', 'READER', 'WRITER'] as const) {
    await grantRole(user.id, role)
    await sameCard()
    expect(await publicPlacement(browser, name)).toEqual({ sections: ['writers'], total: 1 })
    await page.goto('/editorial/team-profile')
    if (role === 'READER') {
      await expect(page.getByText('Access Denied')).toBeVisible()
      expect((await page.request.put('/api/team-profile', { multipart: { bio: 'forbidden' } })).status()).toBe(403)
    } else {
      await expect(heading(page)).toHaveText('Edit your team profile')
      await expect(page.locator('form').getByText('Writer', { exact: true })).toBeVisible()
      await page.getByLabel('Description').fill(expectedBio)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByRole('status')).toContainText('has been saved')
      await sameCard()
    }
  }

  expect(await db().teamMember.count({ where: { userId: user.id } })).toBe(1)
  await context.close()
})
