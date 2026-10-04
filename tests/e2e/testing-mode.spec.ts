import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { db, closeDb, signedIn, uniqueTitle, ArticleEditorPage, removeMyArticles } from './helpers/workflow'
import { makePng } from './helpers/e2eUtils'
import { collectConsoleErrors } from './helpers/console'

test.describe.configure({ mode: 'serial' })
const administratorIds: string[] = []
let context: BrowserContext
let page: Page
let administratorId: string
const banner = () => page.getByRole('region', { name: 'Testing environment' }).locator('strong')
const origin = () => new URL(process.env.E2E_BASE_URL!).origin
async function readyPersona(screen: Page, label: string) {
  await expect(screen).toHaveURL(url => url.pathname === '/editorial')
  await expect(screen.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText(label)
  await expect(screen.getByRole('button', { name: label === 'Administrator' ? 'Test as Writer' : 'Exit testing mode', exact: true })).toBeEnabled()
  await screen.waitForFunction(() => Boolean(document.documentElement.style.getPropertyValue('--testing-banner-height')))
}
async function identityHeaders(ctx = context) {
  const session = await (await ctx.request.get('/api/auth/session')).json()
  return { 'x-consilium-identity': session.requestIdentity }
}
async function switchTo(persona: string) {
  const labels = { writer: 'Writer', 'writer-other': 'Other Writer', editor: 'Editor', 'editor-global': 'Global Editor', growth: 'Growth' } as Record<string, string>
  await page.getByRole('button', { name: `Test as ${labels[persona]}`, exact: true }).last().click()
  await readyPersona(page, labels[persona])
}

test.beforeEach(async ({ browser }) => {
  const key = `test-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const user = await db().user.create({ data: { email: `${key}@consilium.test`, name: 'Test Administrator', role: 'ADMIN', emailVerified: new Date(), password: await bcrypt.hash('testing-local-1234', 10) } })
  administratorId = user.id; administratorIds.push(user.id)
  context = await browser.newContext()
  page = await context.newPage()
  await page.goto('/editorial/login')
  await page.locator('input[type="email"]').fill(user.email)
  await page.locator('input[type="password"]').fill('testing-local-1234')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(u => !u.pathname.includes('/login'))
})
test.afterEach(async () => { await context.close() })
test.afterAll(async () => {
  await removeMyArticles()
  await db().testingSession.deleteMany({ where: { administratorId: { in: administratorIds } } })
  await db().auditLog.deleteMany({ where: { performedBy: { in: administratorIds } } })
  await db().user.deleteMany({ where: { id: { in: administratorIds }, email: { startsWith: 'test-mode-' } } })
  await closeDb()
})

test('entry, switching, refresh, two tabs, back navigation and exit use real personas without changing the administrator', async () => {
  const accountBefore = await db().user.findUniqueOrThrow({ where: { id: administratorId } })
  const rosterBefore = await db().teamMember.findMany({ orderBy: { id: 'asc' } })
  const errors = collectConsoleErrors(page)
  await page.goto('/admin/testing')
  await page.getByRole('button', { name: 'Test as Writer', exact: true }).last().click()
  await readyPersona(page, 'Writer')
  const writerId = (await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'writer' } })).id
  expect((await (await context.request.get('/api/auth/session')).json()).user.id).toBe(writerId)
  const oldHeaders = await identityHeaders()
  const second = await context.newPage()
  await second.goto('/editorial/articles')
  await expect(second.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Writer')
  await page.reload()
  await readyPersona(page, 'Writer')
  await page.getByRole('button', { name: 'Test as Editor', exact: true }).click()
  await readyPersona(page, 'Editor')
  await readyPersona(second, 'Editor')
  const stale = await context.request.put('/api/team-profile', { headers: oldHeaders, multipart: { bio: 'stale-writer-form' } })
  expect(stale.status()).toBe(409)
  expect((await stale.json()).code).toBe('TESTING_IDENTITY_CHANGED')
  await page.goto('/editorial/review')
  await page.goBack()
  await readyPersona(page, 'Editor')
  await page.getByRole('button', { name: 'Test as Growth', exact: true }).click()
  await readyPersona(page, 'Growth')
  await page.goto('/editorial/team-profile', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Exit testing mode' }).click()
  await readyPersona(page, 'Administrator')
  expect((await (await context.request.get('/api/auth/session')).json()).user.id).toBe(administratorId)
  await page.goto('/admin/team')
  await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible()
  const accountAfter = await db().user.findUniqueOrThrow({ where: { id: administratorId } })
  expect({ role: accountAfter.role, password: accountAfter.password, name: accountAfter.name }).toEqual({ role: accountBefore.role, password: accountBefore.password, name: accountBefore.name })
  expect(await db().teamMember.findMany({ orderBy: { id: 'asc' } })).toEqual(rosterBefore)
  expect(errors).toEqual([])
})

test('expiry, forged cookies and replay deny writes and restore normal navigation', async () => {
  await switchTo('writer')
  const oldHeaders = await identityHeaders()
  const cookies = await context.cookies()
  const capability = cookies.find(c => c.name === 'consilium-testing')!
  const session = await db().testingSession.findFirstOrThrow({ where: { administratorId, stoppedAt: null } })
  await db().testingSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  expect((await context.request.put('/api/team-profile', { headers: oldHeaders, multipart: { bio: 'expired-form' } })).status()).toBe(409)
  await page.goto('/editorial')
  await expect(banner()).toContainText('Administrator')
  await context.addCookies([{ ...capability, value: `${capability.value}forged` }])
  expect((await context.request.put('/api/team-profile', { headers: oldHeaders, multipart: { bio: 'forged-cookie' } })).status()).toBe(409)
  await context.addCookies([capability])
  expect((await context.request.put('/api/team-profile', { headers: oldHeaders, multipart: { bio: 'replayed-cookie' } })).status()).toBe(409)
  await page.goto('/admin/team')
  await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible()
})

test('ordinary accounts and anonymous requests cannot enter; origins and arbitrary target parameters are refused', async ({ browser }) => {
  for (const who of ['writer', 'editor', 'growth', null] as const) {
    const ordinary = await signedIn(browser, who)
    const response = await ordinary.request.post('/api/testing-session', { headers: { origin: origin() }, data: { persona: 'writer' } })
    expect(response.status()).toBe(who ? 403 : 401)
    await ordinary.close()
  }
  expect((await context.request.post('/api/testing-session', { data: { persona: 'writer' } })).status()).toBe(403)
  expect((await context.request.post('/api/testing-session', { headers: { origin: 'https://evil.example' }, data: { persona: 'writer' } })).status()).toBe(403)
  expect((await context.request.post('/api/testing-session', { headers: { origin: origin() }, data: { persona: 'writer', userId: administratorId, role: 'ADMIN' } })).status()).toBe(400)
})

test('writer ownership, validation and persisted outcomes match ordinary login', async ({ browser }) => {
  const other = await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'writer-other' } })
  const alien = await db().article.create({ data: { title: uniqueTitle('other-writer'), slug: uniqueTitle('other-slug').replaceAll(' ', '-').toLowerCase(), content: '<p>Private other draft</p>', authorId: other.id, status: 'DRAFT' } })
  const ordinary = await signedIn(browser, 'writer')
  await switchTo('writer')
  const simulatedHeaders = await identityHeaders()
  for (const [ctx, headers] of [[ordinary, {}], [context, simulatedHeaders]] as const) {
    expect((await ctx.request.put(`/api/articles/${alien.id}`, { headers, data: { title: 'stolen', content: '<p>stolen</p>' } })).status()).toBe(403)
    expect((await ctx.request.patch(`/api/editorial/articles/${alien.id}/review`, { headers, data: { action: 'approve' } })).status()).toBe(403)
    expect((await ctx.request.get('/api/editorial/users')).status()).toBe(403)
    const invalid = await ctx.request.put('/api/team-profile', { headers, multipart: { bio: 'x'.repeat(601) } })
    expect(invalid.status()).toBe(400)
    expect((await invalid.json()).code).toBe('INVALID_BIO')
  }
  const title = uniqueTitle('simulated-owner')
  const editor = new ArticleEditorPage(page)
  await editor.openNew()
  await editor.title().fill(title)
  await editor.typeBody('Actual persisted testing content.')
  const saved = await editor.saveNow()
  expect(saved.status).toBe(201)
  const row = await db().article.findUniqueOrThrow({ where: { id: saved.id } })
  expect(row.authorId).toBe((await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'writer' } })).id)
  expect((await ordinary.request.get(`/api/articles/${saved.id}`)).status()).toBe(200)
  expect(row.status).toBe('DRAFT')
  const audit = await db().auditLog.findFirstOrThrow({ where: { performedBy: administratorId, targetId: row.authorId, action: 'testing:mutation-result' }, orderBy: { createdAt: 'desc' } })
  expect(audit.metadata).toMatchObject({ method: 'POST', path: '/api/articles', status: 201 })
  await page.screenshot({ path: test.info().outputPath('writer-draft.png'), fullPage: true })
  await ordinary.close()
})

test('assigned and unassigned editor scope matches ordinary logins, with no administrator override', async ({ browser }) => {
  const author = await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'writer-other' } })
  const categories = await db().category.findMany()
  const opinion = categories.find(c => c.slug === 'opinion')!
  const outside = categories.find(c => c.slug !== 'opinion')!
  const titles = [uniqueTitle('scope-in'), uniqueTitle('scope-out')]
  const articles = await Promise.all([opinion, outside].map((category, i) => db().article.create({ data: { title: titles[i], slug: titles[i].replaceAll(' ', '-').toLowerCase(), content: '<p>Submitted for review</p>', status: 'PENDING_REVIEW', authorId: author.id, categoryId: category.id } })))
  const scoped = await browser.newContext({ storageState: (await import('./helpers/authStorage')).EDITOR_SCOPED_STORAGE })
  await switchTo('editor')
  for (const [ctx, headers] of [[scoped, {}], [context, await identityHeaders()]] as const) {
    expect((await ctx.request.get(`/api/articles/${articles[0].id}`)).status()).toBe(200)
    expect((await ctx.request.get(`/api/articles/${articles[1].id}`)).status()).toBe(403)
    const denied = await ctx.request.patch(`/api/editorial/articles/${articles[1].id}/review`, { headers, data: { action: 'approve' } })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).code).toBe('CATEGORY_SCOPE_DENIED')
  }
  await switchTo('editor-global')
  const global = await signedIn(browser, 'editor')
  for (const ctx of [global, context]) expect((await ctx.request.get(`/api/articles/${articles[1].id}`)).status()).toBe(200)
  expect((await db().article.findUniqueOrThrow({ where: { id: articles[1].id } })).status).toBe('PENDING_REVIEW')
  await page.goto('/editorial/review')
  await page.screenshot({ path: test.info().outputPath('editor-review-queue.png'), fullPage: true })
  await global.close(); await scoped.close()
})

test('growth analytics/profile and denied editorial actions match ordinary login', async ({ browser }) => {
  test.setTimeout(90_000)
  const ordinary = await signedIn(browser, 'growth')
  await switchTo('growth')
  const subscriber = await db().subscriber.create({ data: { email: `growth-parity-${Date.now()}@consilium.test` } })
  try {
  for (const [ctx, headers] of [[ordinary, {}], [context, await identityHeaders()]] as const) {
    expect((await ctx.request.get('/editorial/growth/writer-activity')).status()).toBe(200)
    expect((await ctx.request.get('/api/editorial/users')).status()).toBe(403)
    expect((await ctx.request.post('/api/articles', { headers, data: { title: 'growth cannot write', content: '<p>x</p>' } })).status()).toBe(403)
    const save = await ctx.request.put('/api/team-profile', { headers, multipart: { bio: 'Growth profile parity.' } })
    expect([200, 201]).toContain(save.status())
    expect((await save.json()).bio).toBe('Growth profile parity.')
    const screen = await ctx.newPage()
    const errors = collectConsoleErrors(screen)
    await screen.goto('/editorial/analytics', { waitUntil: 'networkidle' })
    for (const [tab, label] of [['content','Content'],['audience','Audience'],['engagement','Engagement'],['leaderboard','Writers'],['distribution','Distribution'],['overview','Overview']]) {
      const response = tab === 'overview' ? null : screen.waitForResponse(r => r.url().includes(`tab=${tab}`) && r.url().includes('/api/editorial/analytics') && r.ok())
      await screen.getByRole('button', { name: label, exact: true }).click()
      // Overview was already cached from initial load; the other tabs load normally.
      if (response) expect((await response).status()).toBe(200)
      if (tab === 'leaderboard') {
        await expect(screen.locator('table tbody tr').first()).toBeVisible()
        for (const name of ['#','Articles','Reading Mins','Avg Read %','Avg Views','Comments']) {
          await screen.getByRole('button', { name, exact: true }).click()
          await screen.getByRole('button', { name, exact: true }).click()
        }
      }
    }
    for (const [period,label] of [['24h','Last 24 hours'],['7d','Last 7 days'],['90d','Last 90 days'],['30d','Last 30 days']]) {
      const current = screen.getByRole('button', { name: 'Analytics period', exact: true })
      await current.click()
      const response = screen.waitForResponse(r => r.url().includes(`period=${period}`) && r.url().includes('tab=overview') && r.ok())
      await screen.getByRole('button', { name: label, exact: true }).last().click()
      expect((await response).status()).toBe(200)
    }
    await screen.goto('/editorial/growth/subscribers', { waitUntil: 'networkidle' })
    await screen.getByPlaceholder('Search by email…').fill(subscriber.email)
    await expect(screen.locator('table tbody tr')).toHaveCount(1)
    const download = screen.waitForEvent('download')
    await screen.getByRole('button', { name: 'Export CSV' }).click()
    expect((await download).suggestedFilename()).toMatch(/^subscribers-.*\.csv$/)
    await screen.getByPlaceholder('Search by email…').fill('no-match-for-this-fixture')
    await expect(screen.getByText('No subscribers match your search.')).toBeVisible()
    for (const path of ['/editorial/growth/engagement','/editorial/growth/writer-activity']) {
      await screen.goto(path, { waitUntil: 'networkidle' })
      await expect(screen.locator('h1')).toBeVisible()
    }
    expect(errors).toEqual([])
    await screen.close()
  }
  } finally { await db().subscriber.delete({ where: { id: subscriber.id } }); await ordinary.close() }
})

test('persona profile saves, uploads, replacement/removal and failures preserve ownership and appointment', async () => {
  await switchTo('writer')
  const user = await db().user.findUniqueOrThrow({ where: { testPersonaKey: 'writer' } })
  await page.goto('/editorial/team-profile')
  await page.getByLabel('Description').fill('Profile saved by the effective writer.')
  await page.setInputFiles('#tp-photo', { name: 'persona.png', mimeType: 'image/png', buffer: makePng(64, [10, 90, 180]) })
  await page.getByRole('button', { name: /Create profile|Save changes/ }).click()
  await expect(page.getByRole('status')).toContainText('has been saved')
  const before = await db().teamMember.findUniqueOrThrow({ where: { userId: user.id } })
  expect(before.image).toContain(`/avatars/${user.id}/`)
  expect(await db().teamMember.count({ where: { userId: administratorId } })).toBe(0)
  await page.reload()
  await expect(page.getByLabel('Description')).toHaveValue(before.bio!)
  const bad = await context.request.put('/api/team-profile', { headers: await identityHeaders(), multipart: { image: { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('bad') } } })
  expect(bad.status()).toBe(400)
  expect(await db().teamMember.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
  await page.setInputFiles('#tp-photo', { name: 'replacement.png', mimeType: 'image/png', buffer: makePng(64, [200, 30, 100]) })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toContainText('has been saved')
  await page.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toContainText('has been saved')
  const after = await db().teamMember.findUniqueOrThrow({ where: { userId: user.id } })
  expect(after).toMatchObject({ id: before.id, role: before.role, order: before.order, publicTier: before.publicTier, image: null })
  expect(await db().teamMember.count({ where: { userId: user.id } })).toBe(1)
})
