/** Operator browser verification, independently provisioned hosted test workspace only.
 * Never seeds/resets a database or changes account permissions. Reuses the existing
 * browser page object and actual application workflows. Clock fixtures are narrowly
 * conditional on this run's test-owned article and the observed test capability.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { HOSTED_TEST_WORKSPACE as workspace, hostedTestingConfigurationError } from '../src/lib/hostedTestingWorkspace'
import { databaseConnection } from '../src/lib/hostedDatabaseConnection'
import { deploymentReadiness } from '../src/lib/deploymentReadiness'
import { ArticleEditorPage, confirmPublicChange } from '../tests/e2e/helpers/workflow'
import { makePng } from '../tests/e2e/helpers/e2eUtils'
import { formatEditorialScheduleInput } from '../src/lib/editorialSchedule'
import { TESTING_COOKIE } from '../src/lib/testingSessionConstants'
import { acquireHostedVerificationLease } from './lib/hostedVerificationLease'

async function main() {
  if (process.env.TEST_DATABASE_URL || process.env.TEST_HARNESS === '1' || process.env.E2E_ISOLATED === '1') throw new Error('Hosted verification cannot use the destructive automated fixture harness.')
  const envFile = process.env.HOSTED_TEST_ENV_FILE
  const secretFile = process.env.HOSTED_TEST_SECRETS_FILE
  const output = process.env.HOSTED_TEST_EVIDENCE_DIRECTORY
  if (![envFile, secretFile, output].every(p => p && path.isAbsolute(p))) throw new Error('Absolute protected environment, secret and evidence paths are required.')
  const env = JSON.parse(fs.readFileSync(envFile!, 'utf8')) as Record<string, string>
  const error = hostedTestingConfigurationError(env)
  if (error || env.TESTING_MODE_ENABLED !== '1') throw new Error(error ?? 'Testing is disabled.')
  if (env.NEXTAUTH_URL !== workspace.siteOrigin || env.NEXT_PUBLIC_SITE_URL !== workspace.siteOrigin) throw new Error('This operator check requires the canonical isolated origin.')
  const password = JSON.parse(fs.readFileSync(secretFile!, 'utf8')).fixturePassword as string
  if (!password) throw new Error('Dedicated fixture password is required.')
  fs.mkdirSync(output!, { recursive: true, mode: 0o700 })
  const db = new PrismaClient({ adapter: new PrismaPg(databaseConnection(env, env.DIRECT_URL)) })
  const browser = await chromium.launch()
  const contexts: BrowserContext[] = []
  const results: { check: string; status: string }[] = []
  const browserErrors: string[] = []
  const expectedFaultErrors: string[] = []
  const run = `Hosted ${randomUUID()}`
  let advancedClock: { id: string; title: string } | undefined
  let releaseLease: (() => Promise<void>) | undefined
  const id = (key: string) => `hosted-test-${workspace.projectRef}-${key}`
  const verified = (check: string) => { results.push({ check, status: 'passed' }); console.log(`PASS ${check}`) }
  const screenshot = (page: Page, name: string) => page.screenshot({ path: path.join(output!, `${name}.png`), fullPage: true })
  async function login(key: string) {
    const ctx = await browser.newContext({ baseURL: workspace.siteOrigin })
    contexts.push(ctx)
    const page = await ctx.newPage()
    await page.goto('/editorial/login', { waitUntil: 'networkidle' })
    await page.locator('input[type=email]').fill(`${key}@consilium.test`)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL(url => !url.pathname.includes('/login'))
    page.on('pageerror', error => browserErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
    expect((await (await ctx.request.get('/api/auth/session')).json()).user.id).toBe(id(key))
    return { ctx, page }
  }
  async function headers(ctx: BrowserContext) {
    const session = await (await ctx.request.get('/api/auth/session')).json()
    return { 'x-consilium-identity': session.requestIdentity }
  }
  async function persona(page: Page, label: string) {
    await page.getByRole('button', { name: `Test as ${label}`, exact: true }).last().click()
    await expect(page).toHaveURL(url => url.pathname === '/editorial')
    await expect(page.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText(label)
    await expect(page.getByRole('button', { name: 'Exit testing mode' })).toBeEnabled()
  }
  async function article(ctx: BrowserContext, articleId: string) {
    const response = await ctx.request.get(`/api/articles/${articleId}`)
    expect(response.status()).toBe(200)
    return response.json()
  }
  async function extendedChecks(ordinary: Awaited<ReturnType<typeof login>>, admin: Awaited<ReturnType<typeof login>>, scoped: Awaited<ReturnType<typeof login>>) {
    const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)')
    for (const [label, who] of [['ordinary', ordinary], ['simulated', admin]] as const) {
      if (label === 'simulated') {
        await who.page.goto('/admin/testing', { waitUntil: 'networkidle' })
        await persona(who.page, 'Writer')
      }
      const ed = new ArticleEditorPage(who.page)
      await ed.openNew()
      await ed.title().fill(`${run} resilience ${label}`)
      await ed.typeBody('Last successfully saved content.')
      const saved = await ed.saveNow()
      await ed.openExisting(saved.id)
      const before = await db.article.findUniqueOrThrow({ where: { id: saved.id } })
      const faultStart = browserErrors.length
      let faultResponses = 0
      await who.page.route('**/api/articles/*', route => {
        if (route.request().url().endsWith(`/api/articles/${saved.id}`) && ['PUT', 'PATCH'].includes(route.request().method())) {
          faultResponses++
          return route.fulfill({ status: 500, json: { error: 'Controlled hosted save failure' } })
        }
        return route.continue()
      })
      await ed.moveToEnd()
      await who.page.keyboard.type(' Unsaved recovery words.')
      await expect(alert(who.page)).toContainText('unsaved changes remain', { timeout: 20_000 })
      await expect(ed.body()).toContainText('Unsaved recovery words.')
      expect((await db.article.findUniqueOrThrow({ where: { id: saved.id } })).content).toBe(before.content)
      await screenshot(who.page, `${label}-failed-save`)
      await who.page.unroute('**/api/articles/*')
      await ed.saveNow()
      await expect(alert(who.page)).toHaveCount(0)
      await ed.openExisting(saved.id)
      await expect(ed.body()).toContainText('Unsaved recovery words.')
      const observed = browserErrors.slice(faultStart)
      // Retain every console message, accepting only the exact HTTP fault we injected.
      expect(observed.length).toBeGreaterThan(0)
      expect(observed.length).toBeLessThanOrEqual(faultResponses)
      expect(observed, 'Only the controlled HTTP 500 may produce console errors').toEqual(Array(observed.length).fill('Failed to load resource: the server responded with a status of 500 (Internal Server Error)'))
      expectedFaultErrors.push(...observed)
      expect(await db.article.count({ where: { title: before.title, authorId: id('writer') } })).toBe(1)
      verified(`${label} controlled save failure preserves stored and unsaved content; real save/reload recovers once`)

      const uploadFaultStart = browserErrors.length
      const contentBeforeUpload = (await db.article.findUniqueOrThrow({ where: { id: saved.id } })).content
      await who.page.route('**/api/upload', route => route.fulfill({ status: 503, json: { error: 'Controlled upload service failure' } }))
      const chooser = who.page.waitForEvent('filechooser')
      await ed.tool('Insert image').click()
      await (await chooser).setFiles({ name: 'controlled-upload.png', mimeType: 'image/png', buffer: makePng() })
      await expect(alert(who.page)).toContainText('Upload failed:')
      await expect(alert(who.page)).toContainText('Controlled upload service failure')
      await expect(ed.body()).toContainText('Unsaved recovery words.')
      expect((await db.article.findUniqueOrThrow({ where: { id: saved.id } })).content).toBe(contentBeforeUpload)
      await screenshot(who.page, `${label}-failed-upload`)
      await who.page.unroute('**/api/upload')
      const uploadErrors = browserErrors.slice(uploadFaultStart)
      expect(uploadErrors).toEqual(['Failed to load resource: the server responded with a status of 503 (Service Unavailable)'])
      expectedFaultErrors.push(...uploadErrors)
      verified(`${label} controlled upload failure is visible and preserves the last saved article`)

      const owned = await db.teamMember.findUniqueOrThrow({ where: { userId: id('writer') } })
      const identity = await headers(who.ctx)
      for (const [file, status] of [
        [{ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }, 400],
        // This request is rejected by Vercel's body-size gate before our handler.
        [{ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.concat([makePng(), Buffer.alloc(5 * 1024 * 1024)]) }, 413],
      ] as const) {
        const rejected = await who.ctx.request.put('/api/team-profile', { headers: identity, multipart: { image: file } })
        expect(rejected.status()).toBe(status)
        expect(await db.teamMember.findUniqueOrThrow({ where: { userId: id('writer') } })).toEqual(owned)
      }
      verified(`${label} real upload validation rejects invalid/oversized bytes without changing the owned card`)
    }

    // A second tab shares the capability cookie. Refresh, history and navigation
    // must resolve the current persona; an old form must fail before persistence.
    const second = await admin.ctx.newPage()
    second.on('pageerror', error => browserErrors.push(error.message))
    second.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
    await second.goto('/editorial', { waitUntil: 'networkidle' })
    const writerHeaders = await headers(admin.ctx)
    await persona(admin.page, 'Editor')
    // Let the implemented BroadcastChannel navigation finish before a deliberate
    // reload; competing document replacements would test the harness's teardown.
    await expect(second.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Editor')
    await second.waitForLoadState('networkidle')
    await second.reload({ waitUntil: 'networkidle' })
    await expect(second.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Editor')
    expect((await admin.ctx.request.put('/api/team-profile', { headers: writerHeaders, multipart: { bio: 'Denied stale tab' } })).status()).toBe(409)
    await second.goto('/editorial/analytics', { waitUntil: 'networkidle' })
    await second.goBack({ waitUntil: 'networkidle' })
    await expect(second.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Editor')
    const revokedHeaders = await headers(admin.ctx)
    const revokedCookie = (await admin.ctx.cookies()).find(cookie => cookie.name === TESTING_COOKIE)
    expect(revokedCookie).toBeDefined()
    await second.getByRole('button', { name: 'Exit testing mode' }).click()
    await expect(admin.page.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Administrator')
    await admin.page.waitForLoadState('networkidle')
    await admin.page.reload({ waitUntil: 'networkidle' })
    expect((await (await admin.ctx.request.get('/api/auth/session')).json()).user.id).toBe(id('admin'))
    await admin.ctx.addCookies([revokedCookie!])
    expect((await admin.ctx.request.put('/api/team-profile', { headers: revokedHeaders, multipart: { bio: 'Denied revoked replay' } })).status()).toBe(409)
    verified('hosted shared tabs, refresh/back navigation, switch/exit and stale-form rejection')

    await admin.page.goto('/admin/testing', { waitUntil: 'networkidle' })
    await persona(admin.page, 'Writer')
    const session = await (await admin.ctx.request.get('/api/auth/session')).json()
    const expiredHeaders = await headers(admin.ctx)
    const cookie = (await admin.ctx.cookies()).find(cookie => cookie.name === TESTING_COOKIE)
    expect(cookie).toBeDefined()
    expect(session.testing.administratorId).toBe(id('admin'))
    expect((await db.testingSession.updateMany({ where: { id: session.testing.id, administratorId: id('admin'), personaId: id('writer'), stoppedAt: null }, data: { expiresAt: new Date(Date.now() - 60_000) } })).count).toBe(1)
    expect((await admin.ctx.request.put('/api/team-profile', { headers: expiredHeaders, multipart: { bio: 'Denied expired form' } })).status()).toBe(409)
    await admin.page.reload({ waitUntil: 'networkidle' })
    expect((await (await admin.ctx.request.get('/api/auth/session')).json()).user.id).toBe(id('admin'))
    expect((await db.testingSession.findUniqueOrThrow({ where: { id: session.testing.id } })).stopReason).toBe('expiry')
    await admin.ctx.addCookies([cookie!])
    expect((await admin.ctx.request.put('/api/team-profile', { headers: expiredHeaders, multipart: { bio: 'Denied replay' } })).status()).toBe(409)
    await admin.ctx.addCookies([{ ...cookie!, value: `${cookie!.value.slice(0, -1)}${cookie!.value.endsWith('A') ? 'B' : 'A'}` }])
    expect((await admin.ctx.request.put('/api/team-profile', { headers: expiredHeaders, multipart: { bio: 'Denied modified capability' } })).status()).toBe(409)
    const origin = { Origin: workspace.siteOrigin }
    expect((await admin.ctx.request.post('/api/testing-session', { headers: origin, data: { persona: 'writer', userId: id('admin'), role: 'ADMIN' } })).status()).toBe(400)
    expect((await admin.ctx.request.post('/api/testing-session', { headers: { Origin: 'https://example.org' }, data: { persona: 'writer' } })).status()).toBe(403)
    expect((await ordinary.ctx.request.post('/api/testing-session', { headers: origin, data: { persona: 'writer' } })).status()).toBe(403)
    expect((await admin.ctx.request.delete('/api/testing-session', { headers: origin })).status()).toBe(200)
    await second.close()
    verified('hosted deterministic expiry, expired-capability replay, real administrator restoration and forged entry denied')

    // Schedule through the normal review UI. Advance only this run's owned row;
    // refuse to trigger a job if a different run has a due article.
    const ed = new ArticleEditorPage(ordinary.page)
    await ed.openNew()
    await ed.title().fill(`${run} scheduled`)
    await ed.excerpt().fill('Deterministic isolated scheduling verification.')
    await ordinary.page.locator('aside', { has: ordinary.page.getByPlaceholder('Add a tag, press Enter...') }).locator('select').first().selectOption({ label: 'Opinion' })
    await ed.typeBody('Verified scheduled publication content.')
    const saved = await ed.saveNow()
    expect((await ed.saving(() => ordinary.page.getByRole('button', { name: 'Submit', exact: true }).click())).status()).toBe(200)
    await scoped.page.goto(`/editorial/review/${saved.id}`, { waitUntil: 'networkidle' })
    await scoped.page.locator('input[type=datetime-local]').fill(formatEditorialScheduleInput(new Date(Date.now() + 3_600_000)))
    const scheduled = scoped.page.waitForResponse(r => r.url().includes(`/articles/${saved.id}/review`) && r.request().method() === 'PATCH')
    await scoped.page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await confirmPublicChange(scoped.page, 'Schedule')
    expect((await scheduled).status()).toBe(200)
    const row = await db.article.findUniqueOrThrow({ where: { id: saved.id } })
    expect(row.status).toBe('SCHEDULED')
    const url = `${workspace.siteOrigin}/articles/${row.slug}`
    expect((await fetch(url)).status).toBe(404)
    expect(await db.article.count({ where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() }, id: { not: saved.id } } })).toBe(0)
    expect(await db.article.count({ where: { deletedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } })).toBe(0)
    advancedClock = { id: saved.id, title: `${run} scheduled` }
    // Register the exact cleanup identity before advancing the clock. If the
    // database commits and the client then raises, the catch path can still
    // restore only this run's owned fixture instead of leaving it due.
    expect((await db.article.updateMany({ where: { id: saved.id, title: advancedClock.title, authorId: id('writer'), status: 'SCHEDULED' }, data: { scheduledAt: new Date(Date.now() - 60_000) } })).count).toBe(1)
    // Jobs authenticate independently using their server secret, without an
    // administrator's browser cookies or stale simulated-form identity.
    expect((await fetch(`${workspace.siteOrigin}/api/publish-scheduled`, { method: 'POST', headers: { Authorization: 'Bearer invalid-test-job-secret' } })).status).toBe(401)
    const published = await fetch(`${workspace.siteOrigin}/api/publish-scheduled`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })
    expect(published.status).toBe(200)
    expect((await published.json()).articles.map((item: { id: string }) => item.id)).toContain(saved.id)
    expect((await db.article.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('PUBLISHED')
    advancedClock = undefined
    const publicPage = await browser.newPage()
    try {
      expect((await publicPage.goto(url, { waitUntil: 'networkidle' }))!.status()).toBe(200)
      await expect(publicPage.locator('#article-body')).toContainText('Verified scheduled publication content.')
      await screenshot(publicPage, 'scheduled-public-article')
    } finally { await publicPage.close() }
    verified('hosted scheduled article stays private until scoped clock fixture and authenticated real publication job')
  }
  try {
    const marker = await db.siteSetting.findUniqueOrThrow({ where: { key: 'testing-hosted-project' } })
    expect(marker.value).toBe(JSON.stringify(workspace))
    const ready = await deploymentReadiness(db, env)
    expect(ready).toEqual({ healthy: true, gaps: [] })
    releaseLease = await acquireHostedVerificationLease(db, run)
    if (process.env.HOSTED_LEASE_PROBE === '1') {
      console.log('PASS canonical hosted resource/persona lease available; no interactive mutations')
      return
    }
    const robots = await fetch(`${workspace.siteOrigin}/robots.txt`)
    expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await robots.text()).toContain('Disallow: /')
    verified('reviewed hosted database, storage schema and no-index deployment')
    const adminBefore = await db.user.findUniqueOrThrow({ where: { id: id('admin') } })
    const chiefBefore = await db.teamMember.findUniqueOrThrow({ where: { userId: id('admin') } })
    const ordinary = await login('writer')
    const scoped = await login('editor')
    const growth = await login('growth')
    const admin = await login('admin')
    const health = await admin.ctx.request.get('/api/admin/deployment-health')
    expect(health.status()).toBe(200)
    expect(await health.json()).toEqual({ healthy: true, gaps: [] })
    if (process.env.HOSTED_EXTENDED_ONLY === '1') {
      await extendedChecks(ordinary, admin, scoped)
      const adminAfter = await db.user.findUniqueOrThrow({ where: { id: id('admin') } })
      expect({ role: adminAfter.role, password: adminAfter.password, name: adminAfter.name }).toEqual({ role: adminBefore.role, password: adminBefore.password, name: adminBefore.name })
      expect(await db.teamMember.findUniqueOrThrow({ where: { userId: id('admin') } })).toEqual(chiefBefore)
      expect(browserErrors).toEqual(expectedFaultErrors)
      const mail = await db.$queryRaw<{ recipient: string }[]>`SELECT recipient FROM testing_email_outbox WHERE html LIKE ${`%${run}%`}`
      expect(mail.length).toBeGreaterThan(0)
      expect(mail.every(row => row.recipient.endsWith('@consilium.test'))).toBe(true)
      verified('administrator credentials/card unchanged, notifications captured and no unexpected console errors')
      fs.writeFileSync(path.join(output!, 'result.json'), JSON.stringify({ origin: workspace.siteOrigin, project: workspace.projectRef, run, results, capturedEmails: mail.length, browserErrors, expectedFaultErrors, testedAt: new Date().toISOString(), limitations: ['This supplemental run uses the same workflows and covers hosted resilience/session/scheduling. Complete ordinary/simulated publication journeys are recorded separately. API failure injection does not simulate an internal Supabase outage.'] }, null, 2))
      return
    }
    await admin.page.goto('/admin/testing', { waitUntil: 'networkidle' })
    await persona(admin.page, 'Writer')
    const stale = await headers(admin.ctx)
    const otherId = id('unassigned-article')
    for (const ctx of [ordinary.ctx, admin.ctx]) {
      const identity = await headers(ctx)
      expect((await ctx.request.put(`/api/articles/${otherId}`, { headers: identity, data: { title: 'Denied ownership change', content: '<p>Denied</p>' } })).status()).toBe(403)
      expect((await ctx.request.patch(`/api/editorial/articles/${otherId}/review`, { headers: identity, data: { action: 'approve' } })).status()).toBe(403)
      expect((await ctx.request.get('/api/admin/users')).status()).toBe(403)
      const invalid = await ctx.request.put('/api/team-profile', { headers: identity, multipart: { bio: 'x'.repeat(601) } })
      expect(invalid.status()).toBe(400)
      expect((await invalid.json()).code).toBe('INVALID_BIO')
    }
    verified('ordinary and simulated writer ownership, validation and denied editorial/admin parity')
    const publicUrls: string[] = []
    for (const [label, writer] of [['ordinary', ordinary], ['simulated', admin]] as const) {
      const ed = new ArticleEditorPage(writer.page)
      await ed.openNew()
      const title = `${run} ${label}`
      await ed.title().fill(title)
      await ed.excerpt().fill('Hosted verification of the actual writer and editor workflow.')
      await writer.page.locator('aside', { has: writer.page.getByPlaceholder('Add a tag, press Enter...') }).locator('select').first().selectOption({ label: 'Opinion' })
      await ed.typeBody('## Hosted heading\nBold phrase, italic phrase, underline phrase and linked phrase.')
      for (const [text, tool] of [['Bold phrase', 'Bold (Ctrl+B)'], ['italic phrase', 'Italic (Ctrl+I)'], ['underline phrase', 'Underline (Ctrl+U)']]) {
        await ed.select(text); await ed.tool(tool).click()
      }
      await ed.select('linked phrase'); await ed.tool('Insert / edit link').click()
      await writer.page.getByPlaceholder('https://…').fill('https://example.org/source')
      await writer.page.getByRole('button', { name: 'Apply', exact: true }).click()
      await ed.moveToEnd(); await writer.page.keyboard.press('Enter')
      const chooser = writer.page.waitForEvent('filechooser')
      await ed.tool('Insert image').click()
      await (await chooser).setFiles({ name: 'hosted-verification.png', mimeType: 'image/png', buffer: makePng() })
      const figure = ed.body().locator('figure.article-figure')
      await expect(figure.locator('img')).toBeVisible()
      await figure.getByPlaceholder('Add a caption…').fill('Hosted caption')
      const saved = await ed.saveNow()
      await writer.page.reload({ waitUntil: 'networkidle' })
      await expect(ed.body().locator('strong')).toHaveText('Bold phrase')
      await expect(ed.body().locator('em')).toHaveText('italic phrase')
      await expect(ed.body().locator('u')).toHaveText('underline phrase')
      await screenshot(writer.page, `${label}-writer-draft`)
      expect((await article(writer.ctx, saved.id)).authorId).toBe(id('writer'))
      expect((await ed.saving(() => writer.page.getByRole('button', { name: 'Submit', exact: true }).click())).status()).toBe(200)
      expect((await article(writer.ctx, saved.id)).status).toBe('PENDING_REVIEW')
      const reviewer = label === 'ordinary' ? scoped : admin
      if (label === 'simulated') await persona(admin.page, 'Editor')
      await reviewer.page.goto('/editorial/review', { waitUntil: 'networkidle' })
      await reviewer.page.getByRole('link', { name: title, exact: true }).first().click()
      await expect(reviewer.page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await screenshot(reviewer.page, `${label}-editor-review`)
      await reviewer.page.getByPlaceholder('What needs to be revised?').fill('Add a verified source to the conclusion.')
      const returned = reviewer.page.waitForResponse(r => r.url().includes(`/articles/${saved.id}/review`) && r.request().method() === 'PATCH')
      await reviewer.page.getByRole('button', { name: 'Return to Writer' }).click()
      expect((await returned).status()).toBe(200)
      if (label === 'simulated') await persona(admin.page, 'Writer')
      await ed.openExisting(saved.id)
      await expect(writer.page.getByText('Add a verified source to the conclusion.')).toBeVisible()
      await ed.moveToEnd(); await writer.page.keyboard.press('Enter'); await writer.page.keyboard.type('Revised with a verified source.')
      await ed.saveNow()
      expect((await ed.saving(() => writer.page.getByRole('button', { name: 'Submit', exact: true }).click())).status()).toBe(200)
      if (label === 'simulated') await persona(admin.page, 'Editor')
      await reviewer.page.goto(`/editorial/review/${saved.id}`, { waitUntil: 'networkidle' })
      const published = reviewer.page.waitForResponse(r => r.url().includes(`/articles/${saved.id}/review`) && r.request().method() === 'PATCH')
      await reviewer.page.getByRole('button', { name: 'Publish Now', exact: true }).click()
      await confirmPublicChange(reviewer.page, 'Publish now')
      expect((await published).status()).toBe(200)
      const row = await db.article.findUniqueOrThrow({ where: { id: saved.id } })
      expect(row.status).toBe('PUBLISHED')
      const publicPage = await browser.newPage()
      try {
        const url = `${workspace.siteOrigin}/articles/${row.slug}`
        publicUrls.push(url)
        expect((await publicPage.goto(url, { waitUntil: 'networkidle' }))!.status()).toBe(200)
        await expect(publicPage.locator('#article-body strong')).toHaveText('Bold phrase')
        await expect(publicPage.locator('#article-body em')).toHaveText('italic phrase')
        await expect(publicPage.locator('#article-body u')).toHaveText('underline phrase')
        await expect(publicPage.locator('#article-body figcaption')).toContainText('Hosted caption')
        await expect(publicPage.getByText('Revised with a verified source.', { exact: true })).toBeVisible()
        expect(await publicPage.locator('#article-body figure img').first().getAttribute('src')).toContain(workspace.projectRef)
        await screenshot(publicPage, `${label}-public-article`)
      } finally { await publicPage.close() }
      verified(`${label} writer rich-text/media save/reload, editor return, revision/resubmission, publication and public rendering`)
    }
    for (const ctx of [scoped.ctx, admin.ctx]) {
      const identity = await headers(ctx)
      expect((await ctx.request.get(`/api/articles/${otherId}`)).status()).toBe(403)
      expect((await ctx.request.patch(`/api/editorial/articles/${otherId}/review`, { headers: identity, data: { action: 'approve' } })).status()).toBe(403)
    }
    verified('ordinary and simulated editor unassigned category scope denied')
    await persona(admin.page, 'Growth')
    for (const who of [growth, admin]) {
      await who.page.goto('/editorial', { waitUntil: 'networkidle' })
      await expect(who.page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await who.page.goto('/editorial/analytics', { waitUntil: 'networkidle' })
      await expect(who.page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      expect((await who.ctx.request.patch(`/api/editorial/articles/${otherId}/review`, { headers: await headers(who.ctx), data: { action: 'approve' } })).status()).toBe(403)
      expect((await who.ctx.request.get('/api/admin/users')).status()).toBe(403)
      await screenshot(who.page, who === growth ? 'ordinary-growth' : 'simulated-growth')
    }
    verified('ordinary and simulated growth dashboard/analytics and denied editorial/admin parity')
    expect((await admin.ctx.request.put('/api/team-profile', { headers: stale, multipart: { bio: 'stale writer form' } })).status()).toBe(409)
    await persona(admin.page, 'Writer')
    let ownedCardId: string | undefined
    for (const [label, who] of [['ordinary', ordinary], ['simulated', admin]] as const) {
      const existing = await db.teamMember.findUnique({ where: { userId: id('writer') } })
      await who.page.goto('/editorial/team-profile', { waitUntil: 'networkidle' })
      await who.page.getByLabel('Description', { exact: true }).fill(`${label} hosted profile description.`)
      await who.page.locator('input[type=file]').setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer: makePng(48) })
      const saved = who.page.waitForResponse(r => r.url().endsWith('/api/team-profile') && r.request().method() === 'PUT')
      await who.page.getByRole('button', { name: /Create profile|Save changes/ }).click()
      expect((await saved).status()).toBe(existing ? 200 : 201)
      const card = await db.teamMember.findUniqueOrThrow({ where: { userId: id('writer') } })
      if (ownedCardId) expect(card.id).toBe(ownedCardId)
      ownedCardId = card.id
      expect(card.image).toContain(`${workspace.storageOrigin}/storage/v1/object/public/avatars/`)
      expect(await db.teamMember.count({ where: { userId: id('writer') } })).toBe(1)
      await who.page.reload({ waitUntil: 'networkidle' })
      await expect(who.page.getByLabel('Description', { exact: true })).toHaveValue(`${label} hosted profile description.`)
      await expect(who.page.getByAltText('Your profile photo')).toBeVisible()
      await screenshot(who.page, `${label}-team-profile`)
      await who.page.getByRole('button', { name: 'Remove', exact: true }).click()
      const removed = who.page.waitForResponse(r => r.url().endsWith('/api/team-profile') && r.request().method() === 'PUT')
      await who.page.getByRole('button', { name: 'Save changes', exact: true }).click()
      expect((await removed).status()).toBe(200)
      expect((await db.teamMember.findUniqueOrThrow({ where: { userId: id('writer') } })).image).toBeNull()
    }
    verified('ordinary and simulated team biography/photo persistence, real storage, removal and same-card ownership')
    await admin.page.getByRole('button', { name: 'Exit testing mode' }).click()
    await expect(admin.page.getByRole('region', { name: 'Testing environment' }).locator('strong')).toContainText('Administrator')
    expect((await (await admin.ctx.request.get('/api/auth/session')).json()).user.id).toBe(id('admin'))
    await admin.page.goto('/team', { waitUntil: 'networkidle' })
    await expect(admin.page.getByText('Testing Administrator', { exact: true })).toHaveCount(1)
    const chief = admin.page.locator(`[data-team-member-id="${chiefBefore.id}"]`)
    await expect(chief).toHaveAttribute('data-team-card-variant', 'lead')
    await expect(admin.page.locator('section[aria-labelledby]').first().locator('[data-team-member-id]')).toHaveAttribute('data-team-member-id', chiefBefore.id)
    await screenshot(admin.page, 'admin-owned-leading-chief')
    const adminAfter = await db.user.findUniqueOrThrow({ where: { id: id('admin') } })
    expect({ role: adminAfter.role, password: adminAfter.password, name: adminAfter.name }).toEqual({ role: adminBefore.role, password: adminBefore.password, name: adminBefore.name })
    expect(await db.teamMember.findUniqueOrThrow({ where: { userId: id('admin') } })).toEqual(chiefBefore)
    verified('stale mutation denied, exit restores administrator, chief card/account unchanged')
    if (process.env.HOSTED_EXTENDED_CHECKS === '1') await extendedChecks(ordinary, admin, scoped)
    const mail = await db.$queryRaw<{ recipient: string; subject: string }[]>`SELECT recipient,subject FROM testing_email_outbox WHERE html LIKE ${`%${run}%`}`
    expect(mail.length).toBeGreaterThan(0)
    expect(mail.every(row => row.recipient.endsWith('@consilium.test'))).toBe(true)
    const notifications = await db.notification.count({ where: { article: { title: { startsWith: run } } } })
    expect(notifications).toBeGreaterThan(0)
    verified('private database email capture and persisted workflow notifications')
    expect(browserErrors).toEqual(expectedFaultErrors)
    verified('no unexpected application console errors or page exceptions; exact injected fault messages retained')
    fs.writeFileSync(path.join(output!, 'result.json'), JSON.stringify({ origin: workspace.siteOrigin, project: workspace.projectRef, run, results, publicUrls, capturedEmails: mail.length, notifications, browserErrors, expectedFaultErrors, testedAt: new Date().toISOString(), limitations: process.env.HOSTED_EXTENDED_CHECKS === '1' ? ['Every toolbar control and full controlled provider-outage matrix are covered locally; hosted save-failure injection occurs at the API boundary, not inside Supabase.'] : ['Hosted scheduling clock/job controls, every toolbar control, expiry/revocation and controlled storage failures are covered locally; this hosted smoke is a representative parity journey.'] }, null, 2))
  } catch (error) {
    // Failed clock probes must not leave a due row for a subsequent run's job.
    // Never undo a completed publication, touch another run, or alter ownership.
    if (advancedClock) await db.article.updateMany({ where: { id: advancedClock.id, title: advancedClock.title, authorId: id('writer'), status: 'SCHEDULED' }, data: { scheduledAt: new Date(Date.now() + 3_600_000) } })
    const failedPages = []
    for (const [contextIndex, context] of contexts.entries()) {
      for (const [pageIndex, page] of context.pages().entries()) {
        const name = `failure-${contextIndex}-${pageIndex}`
        await screenshot(page, name).catch(() => {})
        failedPages.push({ name, pathname: new URL(page.url()).pathname, alerts: await page.locator('[role="alert"]').allTextContents().catch(() => []), recoveryVisible: await page.getByRole('button', { name: 'Recover local work' }).isVisible().catch(() => false) })
      }
    }
    fs.writeFileSync(path.join(output!, 'failure.json'), JSON.stringify({ run, results, browserErrors, expectedFaultErrors, failedPages, error: error instanceof Error ? error.stack : String(error) }, null, 2))
    throw error
  } finally {
    await Promise.all(contexts.map(ctx => ctx.close()))
    await browser.close()
    await releaseLease?.()
    await db.$disconnect()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
