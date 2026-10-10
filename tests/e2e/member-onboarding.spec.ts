import crypto from 'node:crypto'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { closeDb, db } from './helpers/teamFixtures'
import { makePng, watch } from './helpers/e2eUtils'

/**
 * The real new-hire journey in a browser, with nobody pre-seeded except the
 * administrator doing the hiring:
 *
 *   admin adds an email + role (Members page)  ->  the person signs up (public form)
 *   ->  confirms their email (the emailed link's page)  ->  the role is on, with no
 *   manual database step  ->  dashboard prompts for the team profile  ->  they add
 *   name / photo / bio  ->  admin sets position and visibility  ->  Our Team page
 *   ->  promotion  ->  revocation.
 *
 * The one thing done outside the UI is creating the confirmation token row: the
 * run sends no email (RESEND_API_KEY is blanked by the launcher), and the real table
 * only stores a hash, so the spec inserts the hash of a token it knows and then
 * opens that link's page exactly as the emailed link would.
 *
 * Run through scripts/run-team-profile-e2e.sh. Tests run in order.
 */
test.describe.configure({ mode: 'serial' })

const DOMAIN = '@onboard.consilium.test'
const ADMIN_EMAIL = `onboard-admin${DOMAIN}`
const PASSWORD = 'onboard-pass-1234'

type Section = 'masthead' | 'editorial' | 'writers' | 'growth' | 'wider'
const SECTIONS: Section[] = ['masthead', 'editorial', 'writers', 'growth', 'wider']

let adminContext: BrowserContext
let adminPage: Page

test.beforeAll(async ({ browser }) => {
  const d = db()
  await d.teamMember.deleteMany({ where: { OR: [{ user: { email: { endsWith: DOMAIN } } }, { name: { startsWith: 'Onboard ' } }] } })
  await d.teamMembership.deleteMany({ where: { email: { endsWith: DOMAIN } } })
  await d.user.deleteMany({ where: { email: { endsWith: DOMAIN } } })
  await d.user.create({
    data: { email: ADMIN_EMAIL, name: 'Onboard Admin', role: 'ADMIN', password: await bcrypt.hash(PASSWORD, 10), emailVerified: new Date() },
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
  await adminContext?.close()
  await closeDb()
})

// ── helpers ───────────────────────────────────────────────────────────────────

const row = (page: Page, email: string) => page.getByTestId(`member-${email}`)

async function dismissCookies(page: Page) {
  await page.getByRole('button', { name: 'Decline' }).click({ timeout: 1500 }).catch(() => {})
}

/** Admin: the Members page, add someone by email + role. */
async function addMember(email: string, role: 'Writer' | 'Editor' | 'Growth' | 'Admin') {
  await adminPage.goto('/editorial/members')
  await adminPage.getByLabel('Email', { exact: true }).fill(email)
  await adminPage.getByLabel('Access role', { exact: true }).selectOption({ label: role })
  await adminPage.getByRole('button', { name: 'Add member' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: /Invitation saved|already had an account/ })).toBeVisible()
}

/** The public sign-up form. It signs the new account in. */
async function signUp(browser: Browser, name: string, email: string) {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
  const page = await context.newPage()
  const errors = watch(page)
  await page.goto('/signup')
  await dismissCookies(page)
  await page.getByPlaceholder('Your name').fill(name)
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('At least 8 characters').fill(PASSWORD)
  await page.locator('input[type="checkbox"]').check()
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 })
  return { context, page, errors }
}

/** Open the confirmation page the emailed link points at, and press its button. */
async function confirmEmail(page: Page, userId: string, heading = 'Email confirmed, access activated') {
  const token = crypto.randomBytes(32).toString('hex')
  await db().verificationToken.deleteMany({ where: { identifier: `verify-email:${userId}` } })
  await db().verificationToken.create({
    data: {
      identifier: `verify-email:${userId}`,
      token: crypto.createHash('sha256').update(token).digest('hex'),
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  await page.goto(`/verify-email?token=${token}`)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
}

/** Every public section a person's card shows in, and how many times in total. */
async function publicPlacement(browser: Browser, name: string) {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
  const page = await context.newPage()
  await page.goto('/team')
  await page.waitForLoadState('networkidle')
  const sections: Section[] = []
  let total = 0
  for (const id of SECTIONS) {
    const n = await page.locator(`section[aria-labelledby="team-${id}"] h3:visible`, { hasText: new RegExp(`^${name}$`) }).count()
    if (n > 0) sections.push(id)
    total += n
  }
  const text = await page.locator('body').innerText()
  await context.close()
  return { sections, total, text }
}

const counts = async (email: string) => ({
  users: await db().user.count({ where: { email } }),
  memberships: await db().teamMembership.count({ where: { email } }),
  cards: await db().teamMember.count({ where: { user: { email } } }),
})

// ── a new hire, for each team role ────────────────────────────────────────────

for (const spec of [
  { role: 'WRITER', label: 'Writer', position: 'Staff Writer', section: 'writers' as const, nav: ['My Articles'], noNav: ['Users', 'Members', 'Analytics'] },
  { role: 'EDITOR', label: 'Editor', position: 'Senior Editor', section: 'editorial' as const, nav: ['All Articles'], noNav: ['Members'] },
  { role: 'GROWTH', label: 'Growth', position: 'Social Media Lead', section: 'growth' as const, nav: ['Analytics'], noNav: ['Members', 'All Articles'] },
] as const) {
  test(`new ${spec.label}: hired by email -> signs up -> role on -> profile -> admin publishes -> Our Team`, async ({ browser }) => {
    test.setTimeout(120_000)
    const email = `new-${spec.role.toLowerCase()}${DOMAIN}`
    const name = `Onboard ${spec.label}`

    // 1. The admin adds them BEFORE they have an account.
    await addMember(email, spec.label)
    await expect(row(adminPage, email)).toContainText('Invited, not registered')
    expect(await db().user.count({ where: { email } })).toBe(0)

    // 2. They sign up. Until the address is confirmed they are an ordinary reader.
    const { context, page, errors } = await signUp(browser, name, email)
    const user = await db().user.findUniqueOrThrow({ where: { email } })
    expect(user.role).toBe('READER')
    await page.goto('/profile')
    await expect(page.getByText('Confirm your email', { exact: true })).toBeVisible()
    await page.goto('/editorial')
    await expect(page.getByText('Access Denied')).toBeVisible()

    // 3. Confirming the address claims the invitation.
    await confirmEmail(page, user.id)
    expect(await db().teamMembership.findUniqueOrThrow({ where: { email } })).toMatchObject({ status: 'ACTIVE', userId: user.id, role: spec.role })
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(spec.role)

    // 4. The same session sees the dashboard for the role (read from the database), and
    //    is invited to complete the team profile.
    await page.goto('/editorial')
    await expect(page.getByText('Complete your team profile')).toBeVisible()
    const sidebar = page.getByRole('navigation', { name: 'Editorial navigation' })
    for (const item of spec.nav) await expect(sidebar.getByRole('link', { name: item, exact: true })).toBeVisible()
    for (const item of spec.noNav) await expect(sidebar.getByRole('link', { name: item, exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: 'Team Profile' })).toBeVisible()

    // 5. No elevated access, by page or by API.
    await page.goto('/editorial/members')
    await expect(page).toHaveURL(/\/editorial$/)
    expect((await page.request.get('/api/admin/members')).status()).toBe(403)
    expect((await page.request.post('/api/admin/members', { data: { email: `x${DOMAIN}`, role: 'ADMIN' } })).status()).toBe(403)
    expect((await page.request.patch(`/api/admin/users/${user.id}/role`, { data: { role: 'ADMIN' } })).status()).toBe(403)

    // 6. The team profile: status, then name + photo + bio. No technical fields.
    await page.goto('/editorial/team-profile')
    await expect(page.getByRole('region', { name: 'Profile status' })).toContainText('Profile incomplete')
    await expect(page.locator('select')).toHaveCount(0)
    await page.getByLabel('Name shown on the page').fill(name)
    await page.setInputFiles('#tp-photo', { name: 'me.png', mimeType: 'image/png', buffer: makePng(64, [30, 120, 200]) })
    await page.getByLabel('Description').fill(`I am the new ${spec.label.toLowerCase()}.`)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'has been saved' })).toBeVisible()
    // They cannot set their own position, team, role or visibility: a forged request is refused.
    const forged = await page.request.put('/api/team-profile', { multipart: { bio: 'x', position: 'Editor-in-Chief', role: 'ADMIN' } })
    expect(forged.status()).toBe(400)
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(spec.role)

    // 7. Complete on their side, but not public: no position yet, hidden.
    expect(await publicPlacement(browser, name)).toMatchObject({ sections: [], total: 0 })

    // 8. The admin sees exactly where things stand, then sets position and visibility.
    await adminPage.goto('/editorial/members')
    await expect(row(adminPage, email)).toContainText('Active')
    await expect(row(adminPage, email)).toContainText('Complete, hidden')
    await row(adminPage, email).getByRole('button', { name: 'Manage' }).click()
    await adminPage.getByRole('tab', { name: 'Public profile' }).click()
    await adminPage.getByLabel('Public position', { exact: true }).fill(spec.position)
    await adminPage.getByLabel('Display order').fill('5')
    await adminPage.getByLabel('Show on Our Team page').check()
    await adminPage.getByRole('button', { name: 'Save public details' }).click()
    await expect(adminPage.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
    await expect(row(adminPage, email)).toContainText('Published')

    // 9. They appear exactly once, in the right section, with the admin-set position.
    const placed = await publicPlacement(browser, name)
    expect(placed).toMatchObject({ sections: [spec.section], total: 1 })
    expect(placed.text.toLowerCase()).toContain(spec.position.toLowerCase())

    // 10. Signing in again, in a fresh browser, duplicates nothing and resets nothing.
    const before = await db().teamMember.findMany({ where: { userId: user.id } })
    const again = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
    const login = await again.newPage()
    await login.goto('/login')
    await dismissCookies(login)
    await login.locator('input[type="email"]').fill(email.toUpperCase())
    await login.locator('input[type="password"]').fill(PASSWORD)
    await login.locator('button[type="submit"]').click()
    await login.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
    expect(((await (await login.request.get('/api/auth/session')).json()) as { user?: { role?: string } }).user?.role).toBe(spec.role)
    await again.close()
    expect(await counts(email)).toEqual({ users: 1, memberships: 1, cards: 1 })
    expect(await db().teamMember.findMany({ where: { userId: user.id } })).toEqual(before)

    // Only the deliberate refusals above may appear in the console.
    expect(errors.filter((e) => !/status of (400|403) /.test(e))).toEqual([])
    await context.close()
  })
}

// ── promotion and leaving, on one more person ────────────────────────────────

test('promotion keeps the profile; revoking removes access but not the profile; hiding is separate', async ({ browser }) => {
  test.setTimeout(120_000)
  const email = `journey${DOMAIN}`
  const name = 'Onboard Journey'
  await addMember(email, 'Writer')
  const { context, page } = await signUp(browser, name, email)
  const user = await db().user.findUniqueOrThrow({ where: { email } })
  await confirmEmail(page, user.id)

  await page.goto('/editorial/team-profile')
  await page.getByLabel('Description').fill('Promoted soon.')
  await page.setInputFiles('#tp-photo', { name: 'me.png', mimeType: 'image/png', buffer: makePng(64, [90, 40, 160]) })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'has been saved' })).toBeVisible()

  await adminPage.goto('/editorial/members')
  await row(adminPage, email).getByRole('button', { name: 'Manage' }).click()
  await adminPage.getByRole('tab', { name: 'Public profile' }).click()
  await adminPage.getByLabel('Public position', { exact: true }).fill('Staff Writer')
  await adminPage.getByLabel('Show on Our Team page').check()
  await adminPage.getByRole('button', { name: 'Save public details' }).click()
  await expect(row(adminPage, email)).toContainText('Published')
  const [original] = await db().teamMember.findMany({ where: { userId: user.id } })

  // Promotion: permissions change, the profile does not.
  await adminPage.getByRole('tab', { name: 'Role & permissions' }).click()
  await adminPage.getByLabel(`Access role for ${email}`).selectOption('EDITOR')
  await adminPage.getByRole('button', { name: 'Change role' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: 'Role changed to editor' })).toBeVisible()
  expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('EDITOR')
  expect(await db().teamMember.findMany({ where: { userId: user.id } })).toEqual([original])
  expect(await publicPlacement(browser, name)).toMatchObject({ sections: ['writers'], total: 1 }) // not moved by a permission change
  await page.goto('/editorial/users')
  await expect(page).toHaveURL(/\/editorial$/) // still no admin pages
  expect((await page.request.get('/api/editorial/users')).status()).toBe(200) // editor powers are on

  // Leaving: revoke access, keep the profile.
  await adminPage.goto('/editorial/members')
  await row(adminPage, email).getByRole('button', { name: 'Manage' }).click()
  await adminPage.getByRole('button', { name: 'Revoke access' }).click()
  await adminPage.getByRole('button', { name: 'Confirm revoke' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: 'Access revoked' })).toBeVisible()
  await expect(row(adminPage, email)).toContainText('Revoked')

  await page.goto('/editorial')
  await expect(page.getByText('Access Denied')).toBeVisible()
  expect((await page.request.put('/api/team-profile', { multipart: { bio: 'sneaky' } })).status()).toBe(403)
  expect(await db().teamMember.findMany({ where: { userId: user.id } })).toEqual([original])
  expect(await publicPlacement(browser, name)).toMatchObject({ total: 1 }) // visibility is a separate decision

  // The admin now takes them off the public page; nothing is deleted.
  await adminPage.goto('/editorial/members')
  await row(adminPage, email).getByRole('button', { name: 'Manage' }).click()
  await adminPage.getByRole('tab', { name: 'Public profile' }).click()
  await adminPage.getByLabel('Show on Our Team page').uncheck()
  await adminPage.getByRole('button', { name: 'Save public details' }).click()
  await expect(adminPage.getByRole('status').filter({ hasText: 'Public details saved' })).toBeVisible()
  expect(await publicPlacement(browser, name)).toMatchObject({ total: 0 })
  expect(await db().teamMember.count({ where: { userId: user.id } })).toBe(1)
  expect(await counts(email)).toEqual({ users: 1, memberships: 1, cards: 1 })
  await context.close()
})

// ── an account that existed before the hire ──────────────────────────────────

test('an account created before being hired is upgraded in place once the admin adds its email', async ({ browser }) => {
  test.setTimeout(90_000)
  const email = `early${DOMAIN}`
  const { context, page } = await signUp(browser, 'Onboard Early', email)
  const user = await db().user.findUniqueOrThrow({ where: { email } })
  await confirmEmail(page, user.id, 'Email confirmed') // an address they have already confirmed, with no invitation yet

  await page.goto('/editorial')
  await expect(page.getByText('Access Denied')).toBeVisible()

  await addMember(email, 'Writer')
  await expect(adminPage.getByRole('status').filter({ hasText: 'already had an account' })).toBeVisible()

  await page.goto('/editorial')
  await expect(page.getByText('Complete your team profile')).toBeVisible()
  expect(await counts(email)).toEqual({ users: 1, memberships: 1, cards: 1 })
  await context.close()
})
